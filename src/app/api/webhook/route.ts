import { eq, and, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";

import { db } from "@/db";
import { meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";
import { agentDispatchService, roomService } from "@/lib/livekit-server";

// LiveKit Webhook Receiver — verifies every incoming event with our API secret
const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

export async function POST(req: NextRequest) {
  // Use arrayBuffer and Buffer to ensure we get the absolute raw body for signature verification
  const rawBody = await req.arrayBuffer();
  const body = Buffer.from(rawBody).toString("utf-8");
  const authHeader = req.headers.get("authorization") ?? "";

  // Verify the webhook signature
  let event;
  try {
    event = await receiver.receive(body, authHeader);
  } catch (err) {
    console.error("[livekit-webhook] ❌ Signature verification failed:", err);
    // If verification fails, we STILL return 200 to LiveKit to stop retries,
    // but we don't process the event.
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
    // Mark meeting as active (if upcoming)
    const [updatedMeeting] = await db
      .update(meetings)
      .set({ status: "active", startedAt: new Date() })
      .where(
        and(
          eq(meetings.id, roomName),
          inArray(meetings.status, ["upcoming", "active"]), // Allow even if active to handle rejoin dispatches
        )
      )
      .returning();

    if (updatedMeeting) {
      console.log(`[livekit-webhook] ✅ Meeting ${roomName} marked as active`);

      // Dispatch the LiveKit Agent to join this room.
      // Check first if an agent is already present to avoid duplicate dispatches.
      try {
        const participants = await roomService.listParticipants(roomName);
        const agentAlreadyPresent = participants.some(
          (p) => p.identity?.startsWith("agent-") || p.identity === "meetai-agent"
        );

        if (!agentAlreadyPresent) {
          await agentDispatchService.createDispatch(roomName, "meetai-agent");
          console.log(`[livekit-webhook] 🤖 Agent dispatched to room ${roomName}`);
        } else {
          console.log(`[livekit-webhook] 🤖 Agent already in room ${roomName}, skipping dispatch`);
        }
      } catch (err) {
        console.error(`[livekit-webhook] ❌ Failed to dispatch agent for ${roomName}:`, err);
      }
    }
  }

  // ── Participant Left ────────────────────────────────────────────────────────
  // When a human participant leaves, we just log it.
  // We don't mark as processing immediately because other humans may be in the room,
  // or the same human may be refreshing/reconnecting.
  if (eventName === "participant_left") {
    if (!participantIdentity.startsWith("agent-")) {
       console.log(`[livekit-webhook] 👋 Human participant left room ${roomName}`);
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

    if (transcriptFile?.location) {
      const [updatedMeeting] = await db
        .update(meetings)
        .set({ transcriptUrl: transcriptFile.location })
        .where(eq(meetings.id, egressRoomName))
        .returning();

      if (updatedMeeting) {
        // Trigger Inngest summarization job
        await inngest.send({
          name: "meetings/processing",
          data: {
            meetingId: updatedMeeting.id,
            transcriptUrl: transcriptFile.location,
          },
        });
        console.log(`[livekit-webhook] ✅ Transcript saved & Inngest triggered for ${egressRoomName}`);
      }
    }

    if (recordingFile?.location) {
      await db
        .update(meetings)
        .set({ recordingUrl: recordingFile.location })
        .where(eq(meetings.id, egressRoomName));
      console.log(`[livekit-webhook] 🎥 Recording saved for ${egressRoomName}`);
    }
  }

  return NextResponse.json({ status: "ok" });
}
