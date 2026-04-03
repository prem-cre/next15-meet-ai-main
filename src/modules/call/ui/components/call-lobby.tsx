"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import { LogInIcon, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { generateAvatarUri } from "@/lib/avatar";

interface Props {
  onJoin: () => void;
}

export const CallLobby = ({ onJoin }: Props) => {
  const { data } = authClient.useSession();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [permissionError, setPermissionError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const getMedia = async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (!cancelled) {
          setStream(mediaStream);
          if (videoRef.current) {
            videoRef.current.srcObject = mediaStream;
          }
        }
      } catch {
        if (!cancelled) {
          setPermissionError(true);
        }
      }
    };

    getMedia();

    return () => {
      cancelled = true;
    };
  }, []);

  // Clean up stream on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  // Sync video element when stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const toggleVideo = () => {
    if (stream) {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setVideoEnabled((prev) => !prev);
    }
  };

  const toggleAudio = () => {
    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !track.enabled;
      });
      setAudioEnabled((prev) => !prev);
    }
  };

  const userName = data?.user.name ?? "";
  const userImage =
    data?.user.image ??
    generateAvatarUri({ seed: userName, variant: "initials" });

  return (
    <div className="flex flex-col items-center justify-center h-full bg-radial from-sidebar-accent to-sidebar">
      <div className="py-4 px-8 flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center justify-center gap-y-6 bg-background rounded-lg p-10 shadow-sm">
          <div className="flex flex-col gap-y-2 text-center">
            <h6 className="text-lg font-medium">Ready to join?</h6>
            <p className="text-sm">Set up your call before joining</p>
          </div>

          {/* Video preview */}
          <div className="relative w-[320px] h-[240px] bg-muted rounded-lg overflow-hidden">
            {permissionError ? (
              <div className="flex items-center justify-center h-full p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Please grant your browser permission to access your camera
                  and microphone.
                </p>
              </div>
            ) : videoEnabled ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover -scale-x-100"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={userImage}
                  alt={userName}
                  className="w-20 h-20 rounded-full"
                />
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-x-2">
            <Button
              variant={audioEnabled ? "outline" : "destructive"}
              size="icon"
              onClick={toggleAudio}
              disabled={permissionError}
            >
              {audioEnabled ? <MicIcon className="size-4" /> : <MicOffIcon className="size-4" />}
            </Button>
            <Button
              variant={videoEnabled ? "outline" : "destructive"}
              size="icon"
              onClick={toggleVideo}
              disabled={permissionError}
            >
              {videoEnabled ? <VideoIcon className="size-4" /> : <VideoOffIcon className="size-4" />}
            </Button>
          </div>

          {/* Actions */}
          <div className="flex gap-x-2 justify-between w-full">
            <Button asChild variant="ghost">
              <Link href="/meetings">Cancel</Link>
            </Button>
            <Button onClick={onJoin}>
              <LogInIcon />
              Join Call
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};