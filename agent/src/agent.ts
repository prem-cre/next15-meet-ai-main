import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import path from "node:path";

// Load env from parent directory's .env (shared with Next.js)
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const { AgentSessionEventTypes } = voice;

console.log("[agent] LIVEKIT_URL:", process.env.LIVEKIT_URL);
console.log("[agent] GOOGLE_API_KEY:", process.env.GOOGLE_API_KEY ? "✅ EXISTS" : "❌ MISSING");
console.log("[agent] AGENT_SECRET:", process.env.AGENT_SECRET ? "✅ EXISTS" : "❌ MISSING");

/** Probe which port Next.js is on (3000 or 3001) */
async function getAppUrl(): Promise<string> {
  for (const url of [
    process.env.NEXT_PUBLIC_APP_URL,
    "http://localhost:3000",
    "http://localhost:3001",
  ].filter(Boolean) as string[]) {
    try {
      const r = await fetch(`${url}/api/livekit/token`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.status < 500) return url;
    } catch { /* try next */ }
  }
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

/** POST to Next.js to mark meeting as active */
async function markMeetingActive(roomName: string): Promise<void> {
  try {
    const appUrl = await getAppUrl();
    const res = await fetch(`${appUrl}/api/meetings/${roomName}/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": process.env.AGENT_SECRET || "",
      },
    });
    console.log(`[agent] ✅ start-session HTTP ${res.status}`);
  } catch (err) {
    console.error("[agent] ❌ markMeetingActive failed:", err);
  }
}

/** Send transcript with 3 retries */
async function sendTranscript(roomName: string, transcriptText: string): Promise<void> {
  const appUrl = await getAppUrl();
  const url = `${appUrl}/api/meetings/${roomName}/end-session`;
  console.log(`[agent] 📤 Sending transcript (${transcriptText.length} chars) → ${url}`);

  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-secret": process.env.AGENT_SECRET || "",
        },
        body: JSON.stringify({ transcriptText }),
      });
      const body = await res.text();
      console.log(`[agent] ✅ end-session HTTP ${res.status}: ${body}`);
      return;
    } catch (err) {
      console.error(`[agent] ❌ Attempt ${i}/3:`, String(err));
      if (i < 3) await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  console.error("[agent] ❌ All 3 attempts to send transcript failed");
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    await ctx.connect();
    const roomName = ctx.room.name;
    console.log(`[agent] ✅ Connected to room: ${roomName}`);

    // Mark meeting as active immediately (no webhook required)
    await markMeetingActive(roomName);

    // Parse room metadata for custom persona
    let instructions =
      "You are a helpful AI meeting assistant. Greet the user warmly and help them with their questions.";
    let agentName = "AI Assistant";
    try {
      const meta = JSON.parse(ctx.room.metadata || "{}");
      if (meta.instructions) instructions = meta.instructions;
      if (meta.agentName) agentName = meta.agentName;
      console.log(`[agent] Persona: "${agentName}"`);
    } catch {
      console.log("[agent] No valid metadata, using defaults");
    }

    const geminiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
    if (!geminiApiKey) {
      console.error("[agent] ❌ FATAL: No Gemini API key. Add GOOGLE_API_KEY to .env");
      return;
    }

    const transcript: string[] = [];
    let transcriptSent = false;

    const session = new voice.AgentSession({
      llm: new google.beta.realtime.RealtimeModel({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        apiKey: geminiApiKey,
        voice: "Puck",
        temperature: 0.8,
        // ✅ FIX: Enable user input transcription so UserInputTranscribed events fire
        inputAudioTranscription: {},
        // Also enable output transcription for agent speech capture
        outputAudioTranscription: {},
      }),
    });

    // ── Capture USER speech (fires because inputAudioTranscription is enabled) ──
    session.on(AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal && ev.transcript?.trim()) {
        const line = `[User]: ${ev.transcript.trim()}`;
        transcript.push(line);
        console.log(`[agent] 🎤 ${line}`);
      }
    });

    // ── Capture AGENT speech via ConversationItemAdded ──────────────────────
    session.on(AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      const { item } = ev;
      if (item.role === "assistant") {
        let text = "";
        if (typeof item.content === "string") {
          text = item.content;
        } else if (Array.isArray(item.content)) {
          text = (item.content as any[])
            .map((p) => p?.text || p?.transcript || "")
            .filter(Boolean)
            .join(" ");
        }
        if (text.trim()) {
          const line = `[${agentName}]: ${text.trim()}`;
          transcript.push(line);
          console.log(`[agent] 🔊 ${line}`);
        }
      }
    });

    session.on(AgentSessionEventTypes.Error, (ev) => {
      console.error("[agent] ❌ Session error:", ev.error);
    });

    // ── Use AgentSession Close event — most reliable trigger ─────────────────
    // This fires when the session ends for ANY reason (participant left, etc.)
    session.on(AgentSessionEventTypes.Close, async (ev) => {
      console.log(`[agent] 🔒 Session closed. Reason: ${ev.reason}. Transcript lines: ${transcript.length}`);

      if (transcriptSent) return;
      transcriptSent = true;

      // ALWAYS send end-session — even if transcript is empty
      // end-session will mark meeting completed regardless
      const transcriptText = transcript.length > 0
        ? transcript.join("\n")
        : "__EMPTY__";

      await sendTranscript(roomName, transcriptText);
    });

    await session.start({
      agent: new voice.Agent({ instructions }),
      room: ctx.room,
    });
    console.log("[agent] ✅ Session started");

    // Greet the user
    try {
      await session.generateReply({
        instructions: `You are "${agentName}". Greet the user warmly based on: "${instructions}". Keep it brief — 2-3 sentences.`,
      });
      console.log("[agent] ✅ Greeting sent");
    } catch (err) {
      console.error("[agent] ❌ generateReply failed:", err);
    }

    // Fallback: also send transcript when room disconnects (belt + suspenders)
    ctx.room.on("disconnected", async () => {
      console.log(`[agent] 🔌 Room disconnected. Transcript lines: ${transcript.length}`);
      if (transcriptSent) return;
      transcriptSent = true;

      const transcriptText = transcript.length > 0
        ? transcript.join("\n")
        : "__EMPTY__";

      await sendTranscript(roomName, transcriptText);
    });
  },
});

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "meetai-agent",
  })
);
