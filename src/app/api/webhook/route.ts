import { eq, and, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { WebhookReceiver } from "livekit-server-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { db } from "@/db";
import { meetings } from "@/db/schema";
import { agentDispatchService, roomService } from "@/lib/livekit-server";

const receiver = new WebhookReceiver(
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

const SUMMARIZER_PROMPT = `
You are an expert meeting summarizer. You write readable, concise, and well-structured content.
You are given a transcript of a meeting and need to summarize it clearly.

Use the following markdown structure for every output:

### Overview
Provide a detailed, engaging summary of the meeting. Focus on major topics discussed, decisions made, and key takeaways. Write in a narrative style using full sentences.

### Notes
Break down key content into thematic sections. Each section summarizes key points, decisions, or action items.

#### Key Discussion Points
- Main point or topic discussed
- Another key insight or decision
- Action item or follow-up
`.trim();

/**
 * Run Gemini summarization and save to DB.
 * Called as a safety net from room_finished if agent never sent a transcript.
 */
export async function runSummarization(meetingId: string, transcriptText: string) {
  console.log(`[summarize] 🤖 Running Gemini for meeting ${meetingId} (${transcriptText.length} chars)`);
  try {
    const genAI = new GoogleGenerativeAI(
      process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? ""
    );
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: `${SUMMARIZER_PROMPT}\n\n--- TRANSCRIPT ---\n${transcriptText}` }],
      }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.3 },
    });
    const summary = result.response.text();
    await db
      .update(meetings)
      .set({ status: "completed", summary })
      .where(eq(meetings.id, meetingId));
    console.log(`[summarize] ✅ Summary saved for meeting ${meetingId}`);
  } catch (err) {
    console.error(`[summarize] ❌ Gemini failed for ${meetingId}:`, err);
    await db
      .update(meetings)
      .set({ status: "completed", summary: "Summary could not be generated for this meeting." })
      .where(eq(meetings.id, meetingId));
  }
}

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

    // Safety net: if after 25s the meeting is STILL "processing",
    // the agent never called end-session. Run summarization ourselves.
    setTimeout(async () => {
      try {
        const [meeting] = await db
          .select()
          .from(meetings)
          .where(eq(meetings.id, roomName));

        if (!meeting) return;

        if (meeting.status === "processing") {
          console.log(`[livekit-webhook] ⏰ Safety net: meeting ${roomName} still processing after 25s`);
          const transcript = meeting.transcriptUrl?.trim() || "";

          if (transcript.length > 0 && transcript !== "__EMPTY__") {
            await runSummarization(roomName, transcript);
          } else {
            console.log(`[livekit-webhook] ⚠️ No transcript for ${roomName}, completing without summary`);
            await db
              .update(meetings)
              .set({ status: "completed", summary: "No transcript was recorded for this meeting." })
              .where(eq(meetings.id, roomName));
          }
        } else {
          console.log(`[livekit-webhook] ✅ Meeting ${roomName} already ${meeting.status} — safety net not needed`);
        }
      } catch (err) {
        console.error(`[livekit-webhook] ❌ Safety net error for ${roomName}:`, err);
      }
    }, 25_000);
  }

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
