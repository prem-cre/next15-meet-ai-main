"use client";

import { LoaderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import "@livekit/components-styles";

import { CallUI } from "./call-ui";

interface Props {
  meetingId: string;
  meetingName: string;
  userId: string;
  userName: string;
  userImage: string;
}

export const CallConnect = ({
  meetingId,
  meetingName,
  userId,
  userName,
}: Props) => {
  const [token, setToken] = useState<string>();
  const [error, setError] = useState<string>();

  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  useEffect(() => {
    const fetchToken = async () => {
      try {
        const res = await fetch(
          `/api/livekit/token?room=${encodeURIComponent(meetingId)}&identity=${encodeURIComponent(userId)}&name=${encodeURIComponent(userName)}`
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Token fetch failed" }));
          throw new Error(err.error || "Token fetch failed");
        }
        const data = await res.json();
        setToken(data.token);
      } catch (err) {
        console.error("[CallConnect] token error:", err);
        setError(err instanceof Error ? err.message : "Failed to get token");
      }
    };

    fetchToken();
  }, [meetingId, userId, userName]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-radial from-sidebar-accent to-sidebar">
        <div className="flex flex-col items-center gap-4 text-white">
          <p className="text-lg font-medium">Failed to connect</p>
          <p className="text-sm text-white/70">{error}</p>
        </div>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return (
      <div className="flex h-screen items-center justify-center bg-radial from-sidebar-accent to-sidebar">
        <LoaderIcon className="size-6 animate-spin text-white" />
      </div>
    );
  }

  return (
    <CallUI
      meetingName={meetingName}
      token={token}
      serverUrl={serverUrl}
    />
  );
};
