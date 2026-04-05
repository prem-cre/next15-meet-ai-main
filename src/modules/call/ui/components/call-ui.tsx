"use client";

import { useState, useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";

import { CallLobby } from "./call-lobby";
import { CallActive } from "./call-active";
import { CallEnded } from "./call-ended";

interface Props {
  meetingId: string;
  meetingName: string;
  userName: string;
  userImage: string;
  token: string;
}

/**
 * CallUI — state machine: lobby → call → ended
 *
 * Must be rendered inside <LiveKitRoom> so useRoomContext() works.
 */
export const CallUI = ({
  meetingId,
  meetingName,
  userName,
  userImage,
  token,
}: Props) => {
  const room = useRoomContext();
  const [show, setShow] = useState<"lobby" | "call" | "ended">("lobby");

  useEffect(() => {
    if (!room) return;
    const onDisconnect = () => setShow("ended");
    room.on("disconnected", onDisconnect);
    return () => {
      room.off("disconnected", onDisconnect);
    };
  }, [room]);

  const handleJoin = async () => {
    const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL!;
    console.log("[CallUI] Connecting to room:", meetingId);
    try {
      await room.connect(serverUrl, token, {
        autoSubscribe: true,
      });
      console.log("[CallUI] Connected to room ✅");
      setShow("call");

      // 🚨 DEV MODE FALLBACK: Localhost can't receive webhooks from LiveKit Cloud!
      // Therefore, the webhook cannot summon the agent for you automatically.
      // We manually hit our dispatch API to force the agent into the room.
      fetch(`/api/meetings/${meetingId}/dispatch`, { method: "POST" }).catch(console.error);

    } catch (err) {
      console.error("[CallUI] Failed to connect:", err);
    }
  };

  return (
    <div className="h-full">
      {show === "lobby" && (
        <CallLobby
          onJoin={handleJoin}
          userName={userName}
          userImage={userImage}
        />
      )}
      {show === "call" && (
        <CallActive meetingName={meetingName} />
      )}
      {show === "ended" && <CallEnded />}
    </div>
  );
};
