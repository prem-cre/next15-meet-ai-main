import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { generateLiveKitToken } from "@/lib/livekit-server";

/**
 * GET /api/livekit/token?room=MEETING_ID&identity=USER_ID&name=USER_NAME
 *
 * Returns a signed LiveKit JWT for the authenticated user to join a room.
 * Only accessible to authenticated users.
 */
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const room = searchParams.get("room");
  const identity = searchParams.get("identity") || session.user.id;
  const name =
    searchParams.get("name") ||
    session.user.name ||
    session.user.email ||
    "Participant";

  if (!room) {
    return NextResponse.json({ error: "room is required" }, { status: 400 });
  }

  try {
    const token = await generateLiveKitToken(identity, name, room);
    return NextResponse.json({
      token,
      serverUrl: process.env.LIVEKIT_URL,
    });
  } catch (error) {
    console.error("[livekit/token] token generation failed:", error);
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 }
    );
  }
}
