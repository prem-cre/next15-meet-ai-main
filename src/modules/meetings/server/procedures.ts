import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { AccessToken } from "livekit-server-sdk";
import { and, count, desc, eq, getTableColumns, ilike, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { generateAvatarUri } from "@/lib/avatar";
import { livekitRoomService } from "@/lib/livekit";
import { streamChat } from "@/lib/stream-chat";
import { createTRPCRouter, premiumProcedure, protectedProcedure } from "@/trpc/init";
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from "@/constants";

import { MeetingStatus } from "../types";
import { meetingsInsertSchema, meetingsUpdateSchema } from "../schemas";

// ── Plain text transcript parser ─────────────────────────────────────────────
// Parses "[Speaker]: text" lines into UI-friendly transcript items
function parsePlainTextTranscript(text: string) {
  const lines = text.split("\n").filter((l) => l.trim());
  return lines
    .map((line, idx) => {
      const match = line.match(/^\[(.+?)\]:\s*(.+)$/);
      if (!match) return null;
      const [, speaker, content] = match;
      const isUser = speaker.toLowerCase() === "user";
      return {
        speaker_id: isUser ? "user" : "agent",
        type: "speech",
        text: content.trim(),
        start_ts: idx * 2, // approximate timestamp
        stop_ts: idx * 2 + 2,
        user: {
          name: speaker,
          image: isUser
            ? generateAvatarUri({ seed: speaker, variant: "initials" })
            : generateAvatarUri({ seed: speaker, variant: "botttsNeutral" }),
        },
      };
    })
    .filter(Boolean) as Array<{
      speaker_id: string;
      type: string;
      text: string;
      start_ts: number;
      stop_ts: number;
      user: { name: string; image: string };
    }>;
}

export const meetingsRouter = createTRPCRouter({
  // ── Stream Chat token ────────────────────────────────────────────────────────
  generateChatToken: protectedProcedure.mutation(async ({ ctx }) => {
    const token = streamChat.createToken(ctx.auth.user.id);
    await streamChat.upsertUser({
      id: ctx.auth.user.id,
      role: "admin",
    });
    return token;
  }),

  // ── LiveKit access token ─────────────────────────────────────────────────────
  generateToken: protectedProcedure
    .input(z.object({ roomName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const at = new AccessToken(
        process.env.LIVEKIT_API_KEY!,
        process.env.LIVEKIT_API_SECRET!,
        {
          identity: ctx.auth.user.id,
          name: ctx.auth.user.name,
          ttl: "2h",
        }
      );
      at.addGrant({
        room: input.roomName,
        roomJoin: true,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
      return await at.toJwt();
    }),

  // ── Transcript ───────────────────────────────────────────────────────────────
  getTranscript: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [existingMeeting] = await db
        .select()
        .from(meetings)
        .where(
          and(eq(meetings.id, input.id), eq(meetings.userId, ctx.auth.user.id))
        );

      if (!existingMeeting) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
      }

      const stored = existingMeeting.transcriptUrl;
      if (!stored) return [];

      // Case A: Plain text transcript stored directly in the column (from agent)
      // Lines look like "[User]: Hello" or "[AI Assistant]: Hi there"
      if (!stored.startsWith("http")) {
        return parsePlainTextTranscript(stored);
      }

      // Case B: External URL (JSONL format from LiveKit egress — legacy path)
      try {
        const JSONL = await import("jsonl-parse-stringify");
        const text = await fetch(stored).then((r) => r.text());
        const transcript = JSONL.default.parse<{
          speaker_id: string;
          type: string;
          text: string;
          start_ts: number;
          stop_ts: number;
        }>(text);

        const speakerIds = [...new Set(transcript.map((item) => item.speaker_id))];
        const userSpeakers = await db
          .select()
          .from(user)
          .where(inArray(user.id, speakerIds))
          .then((users) =>
            users.map((u) => ({
              ...u,
              image: u.image ?? generateAvatarUri({ seed: u.name, variant: "initials" }),
            }))
          );
        const agentSpeakers = await db
          .select()
          .from(agents)
          .where(inArray(agents.id, speakerIds))
          .then((rows) =>
            rows.map((a) => ({
              ...a,
              image: generateAvatarUri({ seed: a.name, variant: "botttsNeutral" }),
            }))
          );
        const speakers = [...userSpeakers, ...agentSpeakers];
        return transcript.map((item) => {
          const speaker = speakers.find((s) => s.id === item.speaker_id);
          return {
            ...item,
            user: {
              name: speaker?.name ?? "Unknown",
              image:
                speaker?.image ??
                generateAvatarUri({ seed: "Unknown", variant: "initials" }),
            },
          };
        });
      } catch {
        return [];
      }
    }),

  // ── Dispatch Agent ───────────────────────────────────────────────────────────
  dispatchAgent: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const { agentDispatchService } = await import("@/lib/livekit-server");
        await agentDispatchService.createDispatch(input.id, "meetai-agent");
        return { success: true };
      } catch (err) {
        console.error("Failed to dispatch agent:", err);
        return { success: false, error: "Failed to dispatch agent" };
      }
    }),

  // ── Remove ───────────────────────────────────────────────────────────────────
  remove: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [removedMeeting] = await db
        .delete(meetings)
        .where(
          and(eq(meetings.id, input.id), eq(meetings.userId, ctx.auth.user.id))
        )
        .returning();

      if (!removedMeeting) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
      }

      try {
        await livekitRoomService.deleteRoom(input.id);
      } catch {
        // Room may not exist yet
      }

      return removedMeeting;
    }),

  // ── Update ───────────────────────────────────────────────────────────────────
  update: protectedProcedure
    .input(meetingsUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      const [updatedMeeting] = await db
        .update(meetings)
        .set(input)
        .where(
          and(eq(meetings.id, input.id), eq(meetings.userId, ctx.auth.user.id))
        )
        .returning();

      if (!updatedMeeting) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
      }

      return updatedMeeting;
    }),

  // ── Create ───────────────────────────────────────────────────────────────────
  create: premiumProcedure("meetings")
    .input(meetingsInsertSchema)
    .mutation(async ({ input, ctx }) => {
      const [createdMeeting] = await db
        .insert(meetings)
        .values({ ...input, userId: ctx.auth.user.id })
        .returning();

      const [existingAgent] = await db
        .select()
        .from(agents)
        .where(eq(agents.id, createdMeeting.agentId));

      if (!existingAgent) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found" });
      }

      await livekitRoomService.createRoom({
        name: createdMeeting.id,
        emptyTimeout: 5 * 60,
        maxParticipants: 10,
        metadata: JSON.stringify({
          meetingId: createdMeeting.id,
          meetingName: createdMeeting.name,
          agentId: existingAgent.id,
          agentName: existingAgent.name,
          instructions: existingAgent.instructions,
        }),
      });

      return createdMeeting;
    }),

  // ── Get One ──────────────────────────────────────────────────────────────────
  getOne: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const [existingMeeting] = await db
        .select({
          ...getTableColumns(meetings),
          agent: agents,
          duration: sql<number>`EXTRACT(EPOCH FROM (ended_at - started_at))`.as("duration"),
        })
        .from(meetings)
        .innerJoin(agents, eq(meetings.agentId, agents.id))
        .where(
          and(eq(meetings.id, input.id), eq(meetings.userId, ctx.auth.user.id))
        );

      if (!existingMeeting) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Meeting not found" });
      }

      return existingMeeting;
    }),

  // ── Get Many ──────────────────────────────────────────────────────────────────
  getMany: protectedProcedure
    .input(
      z.object({
        page: z.number().default(DEFAULT_PAGE),
        pageSize: z.number().min(MIN_PAGE_SIZE).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
        search: z.string().nullish(),
        agentId: z.string().nullish(),
        status: z
          .enum([
            MeetingStatus.Upcoming,
            MeetingStatus.Active,
            MeetingStatus.Completed,
            MeetingStatus.Processing,
            MeetingStatus.Cancelled,
          ])
          .nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const { search, page, pageSize, status, agentId } = input;

      const data = await db
        .select({
          ...getTableColumns(meetings),
          agent: agents,
          duration: sql<number>`EXTRACT(EPOCH FROM (ended_at - started_at))`.as("duration"),
        })
        .from(meetings)
        .innerJoin(agents, eq(meetings.agentId, agents.id))
        .where(
          and(
            eq(meetings.userId, ctx.auth.user.id),
            search ? ilike(meetings.name, `%${search}%`) : undefined,
            status ? eq(meetings.status, status) : undefined,
            agentId ? eq(meetings.agentId, agentId) : undefined,
          )
        )
        .orderBy(desc(meetings.createdAt), desc(meetings.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      const [total] = await db
        .select({ count: count() })
        .from(meetings)
        .innerJoin(agents, eq(meetings.agentId, agents.id))
        .where(
          and(
            eq(meetings.userId, ctx.auth.user.id),
            search ? ilike(meetings.name, `%${search}%`) : undefined,
            status ? eq(meetings.status, status) : undefined,
            agentId ? eq(meetings.agentId, agentId) : undefined,
          )
        );

      return {
        items: data,
        total: total.count,
        totalPages: Math.ceil(total.count / pageSize),
      };
    }),
});
