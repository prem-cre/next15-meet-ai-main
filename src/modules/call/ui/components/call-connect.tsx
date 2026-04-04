"use client";

import { useEffect, useState } from "react";
import { LoaderIcon } from "lucide-react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";

import "@livekit/components-styles";

import { authClient } from "@/lib/auth-client";
import { generateAvatarUri } from "@/lib/avatar";

import { CallUI } from "./call-ui";

interface Props {
  meetingId: string;
  meetingName: string;
}

/**
 * CallConnect — fetches a LiveKit token and renders the LiveKitRoom.
 * The room starts in "not connected" mode so CallUI can show the lobby first.
 */
export const CallConnect = ({ meetingId, meetingName }: Props) => {
  const { data: session } = authClient.useSession();

  const [token, setToken] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const userId = session?.user.id ?? "";
  const userName = session?.user.name ?? "";
  const userImage =
    session?.user.image ??
    generateAvatarUri({ seed: userName, variant: "initials" });

  useEffect(() => {
    if (!userId || !userName) return;

    const fetchToken = async () => {
      try {
        const params = new URLSearchParams({
          room: meetingId,
          identity: userId,
          name: userName,
        });
        const res = await fetch(`/api/livekit/token?${params}`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();
        if (!data.token) throw new Error("No token in response");
        setToken(data.token);
      } catch (err) {
        console.error("[CallConnect] Token fetch failed:", err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    fetchToken();
  }, [meetingId, userId, userName]);

  if (loading || !userId) {
    return (
      <div className="flex h-screen items-center justify-center bg-radial from-sidebar-accent to-sidebar">
        <LoaderIcon className="size-6 animate-spin text-white" />
      </div>
    );
  }

  if (error || !token) {
    return (
      <div className="flex h-screen items-center justify-center bg-radial from-sidebar-accent to-sidebar">
        <div className="text-center text-white space-y-2">
          <p className="text-lg font-medium">Failed to connect</p>
          <p className="text-sm opacity-75">{error || "Could not get call token"}</p>
        </div>
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
      token={token}
      connect={false}
      audio={false}
      video={false}
      className="h-screen"
    >
      {/* Renders remote audio tracks automatically */}
      <RoomAudioRenderer />

      <CallUI
        meetingId={meetingId}
        meetingName={meetingName}
        userId={userId}
        userName={userName}
        userImage={userImage}
        token={token}
      />
    </LiveKitRoom>
  );
};
