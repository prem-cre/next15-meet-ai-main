"use client";

import Link from "next/link";
import Image from "next/image";
import {
  ControlBar,
  GridLayout,
  ParticipantTile,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";

import "@livekit/components-styles";

interface Props {
  meetingName: string;
}

/**
 * CallActive — the live call view using LiveKit components.
 *
 * - Shows all participant video tiles in a grid
 * - Renders the LiveKit ControlBar (mute, camera, leave)
 * - onLeave is called when the user clicks the leave button
 */
export const CallActive = ({ meetingName }: Props) => {
  // Subscribe to all camera and screen-share tracks
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  return (
    <div
      className="flex flex-col justify-between h-full text-white"
      style={{ background: "#101213" }}
    >
      {/* Header */}
      <div className="rounded-full px-4 py-3 m-4 flex items-center gap-4 bg-white/10">
        <Link
          href="/"
          className="flex items-center justify-center p-1 bg-white/10 rounded-full w-fit"
        >
          <Image src="/logo.svg" width={22} height={22} alt="Logo" />
        </Link>
        <h4 className="text-base font-medium">{meetingName}</h4>
      </div>

      {/* Video grid */}
      <div className="flex-1 overflow-hidden px-4">
        <GridLayout
          tracks={tracks}
          style={{ height: "100%" }}
        >
          <ParticipantTile />
        </GridLayout>
      </div>

      {/* Controls */}
      <div className="rounded-full px-4 py-2 m-4 bg-white/10 flex justify-center">
        <ControlBar
          variation="minimal"
          controls={{ microphone: true, camera: true, screenShare: true, leave: true }}
        />
      </div>
    </div>
  );
};
