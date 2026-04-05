import { NextRequest, NextResponse } from "next/server";
import { agentDispatchService, roomService } from "@/lib/livekit-server";

/**
 * POST /api/meetings/[meetingId]/dispatch
 * 
 * Local Development Fallback:
 * LiveKit Cloud cannot hit 'http://localhost:3000' with Webhooks when a user joins.
 * This endpoint allows the frontend to manually summon the AI Agent upon connection!
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const { meetingId } = await params;

  try {
    const participants = await roomService.listParticipants(meetingId).catch(() => []);
    const agentAlreadyPresent = participants.some(
      (p) => p.identity.startsWith("agent-") || p.identity === "meetai-agent"
    );

    if (!agentAlreadyPresent) {
      await agentDispatchService.createDispatch(meetingId, "meetai-agent");
      console.log(`[dev-dispatch] 🤖 Agent affirmatively dispatched to room ${meetingId}`);
    } else {
      console.log(`[dev-dispatch] 🤖 Agent already in room ${meetingId}`);
    }

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error(`[dev-dispatch] ❌ Dispatch failed:`, error);
    return NextResponse.json(
      { error: "Failed to dispatch agent." },
      { status: 500 }
    );
  }
}
