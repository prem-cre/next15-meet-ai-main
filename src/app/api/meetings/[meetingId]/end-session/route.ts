import { eq, notInArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { db } from "@/db";
import { meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";

interface Params {
  params: Promise<{ meetingId: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const { meetingId } = await params;

  // Verify agent secret
  const agentSecret = req.headers.get("x-agent-secret");
  if (agentSecret !== process.env.AGENT_SECRET) {
    console.error(`[end-session] ❌ Invalid secret for meeting ${meetingId}`);
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Parse transcript from body
  let transcriptText: string | undefined;
  try {
    const body = await req.json();
    transcriptText = body.transcriptText;
  } catch { /* body is optional */ }

  const hasTranscript =
    transcriptText &&
    transcriptText.trim().length > 10 &&
    transcriptText.trim() !== "__EMPTY__";

  console.log(
    `[end-session] 📝 Meeting ${meetingId} — transcript: ${
      hasTranscript ? `${transcriptText!.length} chars` : "empty/none"
    }`
  );

  // ── Mark meeting as processing ────────────────────────────────────────────
  // Accept from ANY non-final status (upcoming, active) — not just active.
  // This handles the case where webhook wasn't configured so meeting is still "upcoming".
  const [updatedMeeting] = await db
    .update(meetings)
    .set({
      status: "processing",
      endedAt: new Date(),
      // Store transcript text in transcriptUrl column for the Transcript tab
      ...(hasTranscript ? { transcriptUrl: transcriptText! } : {}),
    })
    .where(
      // Update as long as the meeting hasn't already been completed/cancelled
      notInArray(meetings.status, ["completed", "cancelled"]),
    )
    // Also filter by meetingId
    .returning()
    .then((rows) => rows.filter((r) => r.id === meetingId));

  // Since drizzle doesn't support AND with notInArray + eq directly in some versions,
  // let's do it as a separate check:
  if (updatedMeeting.length === 0) {
    // Try a direct update by id
    const [direct] = await db
      .update(meetings)
      .set({
        status: "processing",
        endedAt: new Date(),
        ...(hasTranscript ? { transcriptUrl: transcriptText! } : {}),
      })
      .where(eq(meetings.id, meetingId))
      .returning();

    if (!direct) {
      console.warn(`[end-session] ⚠️ Meeting ${meetingId} not found`);
      return NextResponse.json({ status: "ok", note: "not found" });
    }

    console.log(`[end-session] ✅ Meeting ${meetingId} → processing (direct update)`);
  } else {
    console.log(`[end-session] ✅ Meeting ${meetingId} → processing`);
  }

  // ── Trigger summarization ──────────────────────────────────────────────────
  if (hasTranscript) {
    try {
      await inngest.send({
        name: "meetings/processing",
        data: { meetingId, transcriptText: transcriptText! },
      });
      console.log(`[end-session] 🚀 Inngest triggered for ${meetingId}`);
    } catch (err) {
      console.error(`[end-session] ❌ Inngest failed, using direct Gemini:`, err);
      summarizeDirectly(meetingId, transcriptText!).catch(console.error);
    }
  } else {
    // No transcript — complete immediately with placeholder
    await db
      .update(meetings)
      .set({ status: "completed", summary: "No transcript was recorded for this meeting." })
      .where(eq(meetings.id, meetingId));
    console.log(`[end-session] ✅ Meeting ${meetingId} → completed (no transcript)`);
  }

  return NextResponse.json({ status: "ok" });
}

async function summarizeDirectly(meetingId: string, transcriptText: string): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    await db
      .update(meetings)
      .set({ status: "completed", summary: "No transcript was recorded for this meeting." })
      .where(eq(meetings.id, meetingId));
    return;
  }

  try {
    console.log(`[end-session] 🤖 Direct Gemini summarization for ${meetingId}...`);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(
      `Summarize this meeting transcript in markdown:\n\n### Overview\n[narrative summary]\n\n### Notes\n[bullet points by topic]\n\nTranscript:\n${transcriptText}`
    );
    await db
      .update(meetings)
      .set({ status: "completed", summary: result.response.text().trim() })
      .where(eq(meetings.id, meetingId));
    console.log(`[end-session] ✅ Direct summary saved for ${meetingId}`);
  } catch (err) {
    console.error(`[end-session] ❌ Direct summarization failed:`, err);
    await db
      .update(meetings)
      .set({ status: "completed", summary: "Summary generation failed." })
      .where(eq(meetings.id, meetingId));
  }
}
