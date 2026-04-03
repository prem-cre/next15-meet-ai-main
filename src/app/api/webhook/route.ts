import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";

import { db } from "@/db";
import { agents, meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";

// LiveKit Webhook Receiver — verifies every incoming event with our API secret
const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

export async function POST(req: NextRequest) {
  const body = await req.text();
  const authHeader = req.headers.get("authorization") ?? "";

  // Verify the webhook signature
  let event;
  try {
    event = receiver.receive(body, authHeader);
  } catch (err) {
    console.error("[livekit-webhook] ❌ Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const eventName = event.event;
  const roomName = event.room?.name ?? "";
  const participantIdentity = event.participant?.identity ?? "";

  console.log(`[livekit-webhook] 📨 ${eventName} | room: ${roomName} | participant: ${participantIdentity}`);

  // ── Participant Joined ──────────────────────────────────────────────────────
  // First human participant joining → mark meeting as active
  if (eventName === "participant_joined") {
    // Skip agent participants — they have the agent- prefix or are not in the users table
    // LiveKit agents typically have identities like "agent-XXXX"
    if (participantIdentity.startsWith("agent-")) {
      console.log(`[livekit-webhook] 🤖 Agent joined room ${roomName}, skipping status update`);
      return NextResponse.json({ status: "ok" });
    }

    // Mark meeting as active (only if currently upcoming)
    const [updatedMeeting] = await db
      .update(meetings)
      .set({ status: "active", startedAt: new Date() })
      .where(
        and(
          eq(meetings.id, roomName),
          eq(meetings.status, "upcoming"),
        )
      )
      .returning();

    if (updatedMeeting) {
      console.log(`[livekit-webhook] ✅ Meeting ${roomName} marked as active`);
    }
  }

  // ── Participant Left ────────────────────────────────────────────────────────
  // When a human participant leaves (not the agent), check if meeting should end
  if (eventName === "participant_left") {
    if (!participantIdentity.startsWith("agent-")) {
      console.log(`[livekit-webhook] 👋 Human participant left room ${roomName}`);
      // The room will auto-close based on emptyTimeout set during creation
      // Mark meeting as processing when the human leaves
      await db
        .update(meetings)
        .set({ status: "processing", endedAt: new Date() })
        .where(
          and(
            eq(meetings.id, roomName),
            eq(meetings.status, "active"),
          )
        );
      console.log(`[livekit-webhook] ⏳ Meeting ${roomName} marked as processing`);
    }
  }

  // ── Room Finished ───────────────────────────────────────────────────────────
  // Room closed completely → ensure meeting is processing
  if (eventName === "room_finished") {
    console.log(`[livekit-webhook] 🏁 Room finished: ${roomName}`);
    await db
      .update(meetings)
      .set({ status: "processing", endedAt: new Date() })
      .where(
        and(
          eq(meetings.id, roomName),
          eq(meetings.status, "active"),
        )
      );
  }

  // ── Egress Ended ────────────────────────────────────────────────────────────
  // When recording/transcript egress finishes → save URL and trigger Inngest
  if (eventName === "egress_ended") {
    const egressInfo = event.egressInfo;
    if (!egressInfo) return NextResponse.json({ status: "ok" });

    const egressRoomName = egressInfo.roomName ?? "";

    // Check if this is a transcript egress
    // LiveKit saves transcripts as text files
    const fileResults = egressInfo.fileResults ?? [];
    const transcriptFile = fileResults.find(
      (f) => f.filename?.endsWith(".txt") || f.filename?.endsWith(".jsonl")
    );
    const recordingFile = fileResults.find(
      (f) => f.filename?.endsWith(".mp4")
    );

    if (transcriptFile?.downloadUrl) {
      const [updatedMeeting] = await db
        .update(meetings)
        .set({ transcriptUrl: transcriptFile.downloadUrl })
        .where(eq(meetings.id, egressRoomName))
        .returning();

      if (updatedMeeting) {
        // Trigger Inngest summarization job
        await inngest.send({
          name: "meetings/processing",
          data: {
            meetingId: updatedMeeting.id,
            transcriptUrl: transcriptFile.downloadUrl,
          },
        });
        console.log(`[livekit-webhook] ✅ Transcript saved & Inngest triggered for ${egressRoomName}`);
      }
    }

    if (recordingFile?.downloadUrl) {
      await db
        .update(meetings)
        .set({ recordingUrl: recordingFile.downloadUrl })
        .where(eq(meetings.id, egressRoomName));
      console.log(`[livekit-webhook] 🎥 Recording saved for ${egressRoomName}`);
    }
  }

  return NextResponse.json({ status: "ok" });
}
