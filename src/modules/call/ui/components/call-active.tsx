"use client";

import Link from "next/link";
import Image from "next/image";
import {
  GridLayout,
  ParticipantTile,
  useTracks,
  ControlBar,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";

interface Props {
  meetingName: string;
}

export const CallActive = ({ meetingName }: Props) => {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.Microphone, withPlaceholder: true }, // Agent only has mic
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  return (
    <div className="flex flex-col justify-between p-4 h-full text-white bg-[#111]">
      {/* Header */}
      <div className="bg-[#101213] rounded-full p-4 flex items-center gap-4">
        <Link
          href="/"
          className="flex items-center justify-center p-1 bg-white/10 rounded-full w-fit"
        >
          <Image src="/logo.svg" width={22} height={22} alt="Logo" />
        </Link>
        <h4 className="text-base">{meetingName}</h4>
      </div>

      {/* Video grid */}
      <div className="flex-1 my-4">
        <GridLayout tracks={tracks} className="h-full rounded-lg overflow-hidden">
          <ParticipantTile />
        </GridLayout>
      </div>

      {/* Controls — ControlBar has built-in disconnect/leave button */}
      <div className="bg-[#101213] rounded-full px-4">
        <ControlBar
          variation="minimal"
          controls={{
            microphone: true,
            camera: true,
            screenShare: true,
            leave: true,
          }}
        />
      </div>
    </div>
  );
};
