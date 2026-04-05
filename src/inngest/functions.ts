import { eq, inArray } from "drizzle-orm";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { db } from "@/db";
import { agents, meetings, user } from "@/db/schema";
import { inngest } from "@/inngest/client";

import { StreamTranscriptItem } from "@/modules/meetings/types";

// ── Gemini summarizer helper ─────────────────────────────────────────────────
async function summarizeWithGemini(transcriptText: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("No Gemini API key found. Set GEMINI_API_KEY or GOOGLE_API_KEY in .env");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = `You are an expert meeting summarizer. Analyze this meeting transcript and produce a clear, well-structured summary.

Use this exact markdown format:

### Overview
Write a detailed, engaging narrative summary of the meeting. Cover the main topics discussed, decisions made, and key takeaways. Use full sentences. Minimum 3-4 sentences.

### Notes
Break down key content into thematic sections with timestamps where available. Use bullet points.

Example:
#### Section Name
- Key point or topic discussed
- Decision made or action item
- Follow-up or next step

Now summarize this transcript:

${transcriptText}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  if (!text || text.trim().length < 20) {
    throw new Error("Gemini returned empty or very short summary");
  }
  return text.trim();
}

// ── Inngest function ─────────────────────────────────────────────────────────
export const meetingsProcessing = inngest.createFunction(
  { id: "meetings/processing" },
  { event: "meetings/processing" },
  async ({ event, step }) => {
    const { meetingId, transcriptText, transcriptUrl } = event.data as {
      meetingId: string;
      transcriptText?: string;
      transcriptUrl?: string;
    };

    console.log(`[summarize] 🤖 Starting summarization for meeting: ${meetingId}`);
    console.log(`[summarize] transcriptText chars: ${transcriptText?.length ?? 0}, transcriptUrl: ${transcriptUrl ?? "none"}`);

    // ── Step 1: Get the raw transcript text ───────────────────────────────────
    const rawTranscript = await step.run("get-transcript-text", async () => {
      // Case A: Agent sent plain text transcript directly
      if (transcriptText && transcriptText.trim() && transcriptText !== "__EMPTY__") {
        console.log(`[summarize] 📝 Using inline transcript (${transcriptText.length} chars)`);
        return transcriptText;
      }

      // Case B: JSONL URL from LiveKit egress (older path)
      if (transcriptUrl) {
        try {
          const res = await fetch(transcriptUrl);
          const text = await res.text();
          console.log(`[summarize] 📥 Fetched from URL (${text.length} chars)`);
          return text;
        } catch (err) {
          console.error(`[summarize] ❌ Failed to fetch transcript URL:`, err);
          return "";
        }
      }

      // Case C: Check if transcriptUrl was stored in the DB (inline text)
      const [meeting] = await db.select().from(meetings).where(eq(meetings.id, meetingId));
      if (meeting?.transcriptUrl && meeting.transcriptUrl.trim() && meeting.transcriptUrl !== "__EMPTY__") {
        // transcriptUrl column repurposed for inline transcript text
        if (!meeting.transcriptUrl.startsWith("http")) {
          console.log(`[summarize] 📝 Using transcript from DB column (${meeting.transcriptUrl.length} chars)`);
          return meeting.transcriptUrl;
        }
        // It's an actual URL
        try {
          const res = await fetch(meeting.transcriptUrl);
          return await res.text();
        } catch {
          return "";
        }
      }

      return "";
    });

    // If no transcript, mark completed without summary
    if (!rawTranscript || rawTranscript.trim().length < 10 || rawTranscript.trim() === "__EMPTY__") {
      console.log(`[summarize] ⚠️ No meaningful transcript found for ${meetingId}, marking completed`);
      await step.run("mark-completed-no-summary", async () => {
        await db
          .update(meetings)
          .set({ status: "completed", summary: "No transcript was recorded for this meeting." })
          .where(eq(meetings.id, meetingId));
      });
      return { status: "completed", note: "no transcript" };
    }

    // ── Step 2: Parse and enrich transcript if it's JSONL format ──────────────
    const enrichedTranscript = await step.run("parse-and-enrich", async () => {
      // Detect if it's JSONL (agent plain text won't look like JSON)
      const firstChar = rawTranscript.trim()[0];
      if (firstChar === "{" || firstChar === "[") {
        try {
          const JSONL = await import("jsonl-parse-stringify");
          const items = JSONL.default.parse<StreamTranscriptItem>(rawTranscript);
          const speakerIds = [...new Set(items.map((i) => i.speaker_id))];

          const userSpeakers = await db.select().from(user).where(inArray(user.id, speakerIds));
          const agentSpeakers = await db.select().from(agents).where(inArray(agents.id, speakerIds));
          const speakers = [...userSpeakers, ...agentSpeakers];

          const lines = items.map((item) => {
            const speaker = speakers.find((s) => s.id === item.speaker_id);
            const name = speaker?.name ?? "Unknown";
            return `[${name}]: ${item.text}`;
          });
          return lines.join("\n");
        } catch {
          // Not parseable JSONL, treat as plain text
          return rawTranscript;
        }
      }

      // Already plain text (from agent)
      return rawTranscript;
    });

    // ── Step 3: Run Gemini summarizer ──────────────────────────────────────────
    const summary = await step.run("gemini-summarize", async () => {
      console.log(`[summarize] 🤖 Calling Gemini for meeting ${meetingId} (${enrichedTranscript.length} chars)`);
      try {
        const result = await summarizeWithGemini(enrichedTranscript);
        console.log(`[summarize] ✅ Gemini returned ${result.length} chars`);
        return result;
      } catch (err) {
        console.error(`[summarize] ❌ Gemini error:`, err);
        return `Summary generation failed: ${String(err)}`;
      }
    });

    // ── Step 4: Save summary, mark meeting completed ───────────────────────────
    await step.run("save-summary", async () => {
      await db
        .update(meetings)
        .set({ summary, status: "completed" })
        .where(eq(meetings.id, meetingId));
      console.log(`[summarize] ✅ Summary saved for meeting ${meetingId}`);
    });

    return { status: "completed", summaryLength: summary.length };
  }
);

// ── Safety Net ───────────────────────────────────────────────────────────────
// Triggered when a room finishes — ensures summarization runs even if the 
// agent fails to call /end-session itself.
export const meetingsSafetyNet = inngest.createFunction(
  { id: "meetings/safety-net" },
  { event: "meetings/safety-net" },
  async ({ event, step }) => {
    const { meetingId } = event.data;

    await step.sleep("wait-for-agent", "25s");

    const meeting = await step.run("check-meeting-status", async () => {
      const [m] = await db
        .select()
        .from(meetings)
        .where(eq(meetings.id, meetingId));
      return m;
    });

    if (!meeting) return { status: "not_found" };

    if (meeting.status === "processing") {
      console.log(`[safety-net] ⏰ Running summarization for ${meetingId}`);
      
      const transcript = meeting.transcriptUrl?.trim() || "";
      if (transcript.length > 10 && transcript !== "__EMPTY__") {
        await step.sendEvent("trigger-processing", {
          name: "meetings/processing",
          data: { meetingId, transcriptText: transcript },
        });
      } else {
        await step.run("mark-completed-no-summary", async () => {
          await db
            .update(meetings)
            .set({ 
              status: "completed", 
              summary: "No transcript was recorded for this meeting." 
            })
            .where(eq(meetings.id, meetingId));
        });
      }
      return { status: "summarized" };
    }

    return { status: "already_completed", current_status: meeting.status };
  }
);
