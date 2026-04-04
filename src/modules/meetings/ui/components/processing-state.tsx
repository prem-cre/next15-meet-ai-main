"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderIcon } from "lucide-react";

import { useTRPC } from "@/trpc/client";
import { EmptyState } from "@/components/empty-state";

interface Props {
  meetingId: string;
}

export const ProcessingState = ({ meetingId }: Props) => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  // Poll every 5 seconds while processing — when Inngest finishes and sets
  // status to "completed", the next poll will return the new status and the
  // parent MeetingIdView will switch to <CompletedState />.
  useEffect(() => {
    const interval = setInterval(() => {
      queryClient.invalidateQueries(
        trpc.meetings.getOne.queryOptions({ id: meetingId })
      );
    }, 5000);

    return () => clearInterval(interval);
  }, [meetingId, queryClient, trpc.meetings.getOne]);

  return (
    <div className="bg-white rounded-lg px-4 py-5 flex flex-col gap-y-8 items-center justify-center">
      <EmptyState
        image="/processing.svg"
        title="Meeting completed"
        description="Generating your summary — this usually takes 10–30 seconds…"
      />
      <div className="flex items-center gap-x-2 text-sm text-muted-foreground">
        <LoaderIcon className="size-4 animate-spin" />
        <span>Processing transcript…</span>
      </div>
    </div>
  );
};
