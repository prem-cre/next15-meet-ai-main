"use client";

import { useState } from "react";
import { LiveKitRoom, RoomAudioRenderer } from "@livekit/components-react";
import "@livekit/components-styles";

import { CallLobby } from "./call-lobby";
import { CallActive } from "./call-active";
import { CallEnded } from "./call-ended";

interface Props {
  meetingName: string;
  token: string;
  serverUrl: string;
}

export const CallUI = ({ meetingName, token, serverUrl }: Props) => {
  const [show, setShow] = useState<"lobby" | "call" | "ended">("lobby");

  return (
    <div className="h-full">
      {show === "lobby" && <CallLobby onJoin={() => setShow("call")} />}
      
      {show === "call" && (
        <LiveKitRoom
          token={token}
          serverUrl={serverUrl}
          connect={true}
          className="h-full"
          data-lk-theme="default"
          onDisconnected={() => setShow("ended")}
        >
          <RoomAudioRenderer />
          <CallActive meetingName={meetingName} />
        </LiveKitRoom>
      )}

      {show === "ended" && <CallEnded />}
    </div>
  );
};
