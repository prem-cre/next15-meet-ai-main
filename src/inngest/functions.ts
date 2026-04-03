import { eq, inArray } from "drizzle-orm";
import JSONL from "jsonl-parse-stringify";
import { createAgent, openai, TextMessage } from "@inngest/agent-kit";

import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { inngest } from "@/inngest/client";

import { StreamTranscriptItem } from "@/modules/meetings/types";

const summarizer = createAgent({
  name: "summarizer",
  system: `
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
  `.trim(),
  model: openai({
    model: "gpt-4o",
    apiKey: process.env.OPENAI_API_KEY,
  }),
});

export const meetingsProcessing = inngest.createFunction(
  { id: "meetings/processing" },
  { event: "meetings/processing" },
  async ({ event, step }) => {
    // Step 1: Fetch the raw JSONL transcript from Stream
    const response = await step.run("fetch-transcript", async () => {
      return fetch(event.data.transcriptUrl).then((res) => res.text());
    });

    // Step 2: Parse JSONL into transcript items
    const transcript = await step.run("parse-transcript", async () => {
      return JSONL.parse<StreamTranscriptItem>(response);
    });

    // Step 3: Resolve speaker IDs to names
    const transcriptWithSpeakers = await step.run("add-speakers", async () => {
      const speakerIds = [...new Set(transcript.map((item) => item.speaker_id))];

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

      return transcript.map((item) => {
        const speaker = speakers.find((s) => s.id === item.speaker_id);
        return {
          ...item,
          user: { name: speaker?.name ?? "Unknown" },
        };
      });
    });

    // Step 4: Run the AI summarizer
    const { output } = await summarizer.run(
      "Summarize the following meeting transcript:\n\n" +
        JSON.stringify(transcriptWithSpeakers)
    );

    // Step 5: Save summary and mark meeting as completed
    await step.run("save-summary", async () => {
      await db
        .update(meetings)
        .set({
          summary: (output[0] as TextMessage).content as string,
          status: "completed",
        })
        .where(eq(meetings.id, event.data.meetingId));
    });
  }
);
