import { eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/db";
import { meetings } from "@/db/schema";

interface Params {
  params: Promise<{ meetingId: string }>;
}

/**
 * POST /api/meetings/[meetingId]/start
 *
 * Called by the LiveKit agent worker the moment it connects to a room.
 * Marks the meeting as "active" so the dashboard shows the live state.
 *
 * This replaces relying on LiveKit Cloud webhooks for status updates.
 * Auth: shared AGENT_SECRET header.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { meetingId } = await params;

  const agentSecret = req.headers.get("x-agent-secret");
  if (agentSecret !== process.env.AGENT_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [updatedMeeting] = await db
    .update(meetings)
    .set({ status: "active", startedAt: new Date() })
    .where(
      // Only update if still upcoming (don't overwrite active/processing/completed)
      eq(meetings.id, meetingId),
    )
    .returning();

  if (updatedMeeting) {
    console.log(`[start-session] ✅ Meeting ${meetingId} marked as active`);
  } else {
    console.log(`[start-session] ⚠️ Meeting ${meetingId} not found`);
  }

  return NextResponse.json({ status: "ok" });
}
