"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { LogInIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
  onJoin: () => void;
  userName: string;
  userImage: string;
}

/**
 * CallLobby — pre-call screen with camera/mic preview.
 *
 * Uses native browser MediaDevices API — no Stream SDK dependency.
 * Connects mic/cam preview locally; the real room connection happens on Join.
 */
export const CallLobby = ({ onJoin, userName, userImage }: Props) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [joining, setJoining] = useState(false);

  // Request camera + mic on mount
  useEffect(() => {
    let localStream: MediaStream | null = null;

    const requestMedia = async () => {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setStream(localStream);
        setCameraOn(true);
        setMicOn(true);
        if (videoRef.current) {
          videoRef.current.srcObject = localStream;
        }
      } catch {
        // Browser denied or no camera
        setPermissionDenied(true);
      }
    };

    requestMedia();

    return () => {
      // Cleanup preview tracks when leaving lobby
      localStream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const toggleCamera = () => {
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setCameraOn(videoTrack.enabled);
    }
  };

  const toggleMic = () => {
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setMicOn(audioTrack.enabled);
    }
  };

  const handleJoin = async () => {
    // Stop preview tracks before handing off to LiveKit
    stream?.getTracks().forEach((t) => t.stop());
    setJoining(true);
    onJoin();
  };

  return (
    <div className="flex flex-col items-center justify-center h-full bg-radial from-sidebar-accent to-sidebar">
      <div className="py-4 px-8 flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center justify-center gap-y-6 bg-background rounded-lg p-10 shadow-sm min-w-[340px]">
          {/* Title */}
          <div className="flex flex-col gap-y-2 text-center">
            <h6 className="text-lg font-medium">Ready to join?</h6>
            <p className="text-sm text-muted-foreground">
              {permissionDenied
                ? "Camera/mic access denied. You can still join."
                : "Set up your audio and video before joining."}
            </p>
          </div>

          {/* Video preview */}
          <div className="relative w-64 h-48 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
            {cameraOn && !permissionDenied ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
            ) : (
              <div className="flex flex-col items-center gap-2">
                {userImage ? (
                  <Image
                    src={userImage}
                    alt={userName}
                    width={64}
                    height={64}
                    className="rounded-full"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center text-white text-2xl font-bold">
                    {userName?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <p className="text-sm text-muted-foreground">{userName}</p>
              </div>
            )}
          </div>

          {/* Controls */}
          {!permissionDenied && (
            <div className="flex gap-x-3">
              <Button
                variant={micOn ? "outline" : "destructive"}
                size="icon"
                onClick={toggleMic}
                title={micOn ? "Mute microphone" : "Unmute microphone"}
              >
                {micOn ? <MicIcon className="size-4" /> : <MicOffIcon className="size-4" />}
              </Button>
              <Button
                variant={cameraOn ? "outline" : "destructive"}
                size="icon"
                onClick={toggleCamera}
                title={cameraOn ? "Turn off camera" : "Turn on camera"}
              >
                {cameraOn ? <VideoIcon className="size-4" /> : <VideoOffIcon className="size-4" />}
              </Button>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-x-2 justify-between w-full">
            <Button asChild variant="ghost">
              <Link href="/meetings">Cancel</Link>
            </Button>
            <Button onClick={handleJoin} disabled={joining}>
              {joining ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin">⏳</span>
                  Joining...
                </span>
              ) : (
                <>
                  <LogInIcon className="size-4 mr-2" />
                  Join Call
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
