import { eq, and, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { WebhookReceiver } from "livekit-server-sdk";

import { db } from "@/db";
import { meetings } from "@/db/schema";
import { agentDispatchService, roomService } from "@/lib/livekit-server";

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

// SUMMARIZER_PROMPT moved to Inngest functions.

// runSummarization moved to Inngest functions for reliability on Vercel.

export async function POST(req: NextRequest) {
  const rawBody = await req.arrayBuffer();
  const body = Buffer.from(rawBody).toString("utf-8");
  const authHeader = req.headers.get("authorization") ?? "";

  let event;
  try {
    event = await receiver.receive(body, authHeader);
  } catch (err) {
    console.error("[livekit-webhook] ❌ Signature verification failed:", err);
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  const eventName = event.event;
  const roomName = event.room?.name ?? "";
  const participantIdentity = event.participant?.identity ?? "";

  console.log(`[livekit-webhook] 📨 ${eventName} | room: ${roomName} | participant: ${participantIdentity}`);

  // ── Participant Joined ──────────────────────────────────────────────────────
  if (eventName === "participant_joined") {
    // Skip the agent joining its own room
    if (participantIdentity.startsWith("agent-") || participantIdentity === "meetai-agent") {
      console.log(`[livekit-webhook] 🤖 Agent joined ${roomName}, skipping`);
      return NextResponse.json({ status: "ok" });
    }

    const [updatedMeeting] = await db
      .update(meetings)
      .set({ status: "active", startedAt: new Date() })
      .where(and(eq(meetings.id, roomName), inArray(meetings.status, ["upcoming", "active"])))
      .returning();

    if (updatedMeeting) {
      console.log(`[livekit-webhook] ✅ Meeting ${roomName} marked active`);

      try {
        const participants = await roomService.listParticipants(roomName);
        const agentAlreadyPresent = participants.some(
          (p) => p.identity?.startsWith("agent-") || p.identity === "meetai-agent"
        );

        if (!agentAlreadyPresent) {
          await agentDispatchService.createDispatch(roomName, "meetai-agent");
          console.log(`[livekit-webhook] 🤖 Agent dispatched to ${roomName}`);
        } else {
          console.log(`[livekit-webhook] 🤖 Agent already present in ${roomName}`);
        }
      } catch (err) {
        console.error(`[livekit-webhook] ❌ Dispatch failed for ${roomName}:`, err);
      }
    }
  }

  // ── Participant Left ────────────────────────────────────────────────────────
  if (eventName === "participant_left") {
    if (!participantIdentity.startsWith("agent-") && participantIdentity !== "meetai-agent") {
      console.log(`[livekit-webhook] 👋 Human left ${roomName}`);
    }
  }

  // ── Room Finished ───────────────────────────────────────────────────────────
  if (eventName === "room_finished") {
    console.log(`[livekit-webhook] 🏁 Room finished: ${roomName}`);

    await db
      .update(meetings)
      .set({ status: "processing", endedAt: new Date() })
      .where(and(eq(meetings.id, roomName), eq(meetings.status, "active")));

    // Safety net: Trigger Inngest to wait 25s and check if agent sent transcript.
    // This replaces setTimeout which doesn't work reliably on Vercel serverless.
    try {
      const { inngest } = await import("@/inngest/client");
      await inngest.send({
        name: "meetings/safety-net",
        data: { meetingId: roomName },
      });
      console.log(`[livekit-webhook] 🚀 Safety net triggered for ${roomName}`);
    } catch (err) {
      console.error("[livekit-webhook] ❌ Failed to trigger safety net:", err);
    }  }

  // ── Egress Ended ────────────────────────────────────────────────────────────
  if (eventName === "egress_ended") {
    const egressInfo = event.egressInfo;
    if (!egressInfo) return NextResponse.json({ status: "ok" });
    const egressRoomName = egressInfo.roomName ?? "";
    const fileResults = egressInfo.fileResults ?? [];
    const recordingFile = fileResults.find((f) => f.filename?.endsWith(".mp4"));
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
