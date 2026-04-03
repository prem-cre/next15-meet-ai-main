import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { meetings } from "@/db/schema";
import { inngest } from "@/inngest/client";

interface Params {
  params: Promise<{ meetingId: string }>;
}

/**
 * POST /api/meetings/[meetingId]/end-session
 *
 * Called by the LiveKit agent worker when it detects the human participant
 * has left the room. It provides the conversation transcript so we can
 * trigger the Inngest summarizer.
 *
 * Protected by a shared AGENT_SECRET header so only our agent can call it.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { meetingId } = await params;

  // Verify the request comes from our agent
  const agentSecret = req.headers.get("x-agent-secret");
  if (agentSecret !== process.env.AGENT_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let transcriptText: string | undefined;
  try {
    const body = await req.json();
    transcriptText = body.transcriptText;
  } catch {
    // No body is fine — we'll just mark as processing without transcript
  }

  // Mark meeting as processing
  const [updatedMeeting] = await db
    .update(meetings)
    .set({
      status: "processing",
      endedAt: new Date(),
      // Store transcript text in transcriptUrl column (repurposed for inline text)
      ...(transcriptText ? { transcriptUrl: transcriptText } : {}),
    })
    .where(
      and(
        eq(meetings.id, meetingId),
        eq(meetings.status, "active"),
      )
    )
    .returning();

  if (!updatedMeeting) {
    return NextResponse.json(
      { error: "Meeting not found or not active" },
      { status: 404 }
    );
  }

  // Trigger Inngest summarizer only if we have transcript data
  if (transcriptText && transcriptText.trim().length > 0) {
    await inngest.send({
      name: "meetings/processing",
      data: {
        meetingId: updatedMeeting.id,
        transcriptText,
      },
    });
  } else {
    // Mark as completed immediately if no transcript
    await db
      .update(meetings)
      .set({ status: "completed" })
      .where(eq(meetings.id, meetingId));
  }

  return NextResponse.json({ status: "ok" });
}
