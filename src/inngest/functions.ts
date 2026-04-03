import { eq, inArray } from "drizzle-orm";
import JSONL from "jsonl-parse-stringify";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { inngest } from "@/inngest/client";

import { StreamTranscriptItem } from "@/modules/meetings/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "");

const SUMMARIZER_SYSTEM_PROMPT = `
You are an expert meeting summarizer. You write readable, concise, and well-structured content.
You are given a transcript of a meeting and need to summarize it clearly.

Use the following markdown structure for every output:

### Overview
Provide a detailed, engaging summary of the meeting. Focus on major topics discussed, decisions made, and key takeaways. Write in a narrative style using full sentences.

### Notes
Break down key content into thematic sections with timestamp ranges. Each section should summarize key points, actions, or demos in bullet format.

Example:
#### Section Name
- Main point or topic discussed
- Another key insight or decision
- Action item or follow-up

#### Next Section
- Feature X does Y
- Integration with Z was mentioned
`.trim();

export const meetingsProcessing = inngest.createFunction(
  { id: "meetings/processing" },
  { event: "meetings/processing" },
  async ({ event, step }) => {
    // Step 1: Get the transcript text
    // It could come as inline text from the agent or as a URL from LiveKit egress
    const transcriptRaw = await step.run("get-transcript", async () => {
      // Inline transcript text sent directly by the agent
      if (event.data.transcriptText) {
        return event.data.transcriptText as string;
      }
      // Fallback: fetch from URL (LiveKit egress or old Stream format)
      if (event.data.transcriptUrl) {
        return await fetch(event.data.transcriptUrl).then((res) => res.text());
      }
      return "";
    });

    if (!transcriptRaw || transcriptRaw.trim().length === 0) {
      // No transcript → mark as completed immediately
      await step.run("no-transcript", async () => {
        await db
          .update(meetings)
          .set({ status: "completed", summary: "No transcript available for this meeting." })
          .where(eq(meetings.id, event.data.meetingId));
      });
      return;
    }

    // Step 2: Parse transcript (supports JSONL and plain text)
    const formattedTranscript = await step.run("format-transcript", async () => {
      // Try parsing as JSONL first
      try {
        const parsed = JSONL.parse<StreamTranscriptItem>(transcriptRaw);
        if (parsed.length > 0) {
          // Resolve speaker IDs to names
          const speakerIds = [...new Set(parsed.map((item) => item.speaker_id))];

          const userSpeakers = await db
            .select()
            .from(user)
            .where(inArray(user.id, speakerIds))
            .then((rows) => rows.map((u) => ({ ...u })));

          const agentSpeakers = await db
            .select()
            .from(agents)
            .where(inArray(agents.id, speakerIds))
            .then((rows) => rows.map((a) => ({ ...a })));

          const speakers = [...userSpeakers, ...agentSpeakers];

          return parsed
            .map((item) => {
              const speaker = speakers.find((s) => s.id === item.speaker_id);
              const name = speaker?.name ?? "Unknown";
              return `[${name}]: ${item.text}`;
            })
            .join("\n");
        }
      } catch {
        // Not JSONL — use as plain text
      }

      // Plain text transcript (from agent)
      return transcriptRaw;
    });

    // Step 3: Run the Gemini summarizer
    const summary = await step.run("generate-summary", async () => {
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${SUMMARIZER_SYSTEM_PROMPT}\n\n--- TRANSCRIPT ---\n${formattedTranscript}`,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.3,
        },
      });

      const response = result.response;
      return response.text();
    });

    // Step 4: Save summary and mark meeting as completed
    await step.run("save-summary", async () => {
      await db
        .update(meetings)
        .set({
          summary,
          status: "completed",
        })
        .where(eq(meetings.id, event.data.meetingId));
    });
  }
);
