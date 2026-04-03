import {
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import * as google from "@livekit/agents-plugin-google";
import * as silero from "@livekit/agents-plugin-silero";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { MeetAIAgent } from "./meet-agent";

// Load env from parent directory's .env (shared with Next.js)
dotenv.config({ path: "../.env" });

/**
 * MeetAI Voice Agent
 *
 * This agent runs as a separate Node.js process alongside the Next.js app.
 * It connects to LiveKit Cloud and auto-joins rooms when participants connect.
 *
 * Architecture:
 *   1. User creates a meeting → Next.js creates a LiveKit room with agent metadata
 *   2. User joins the room → LiveKit dispatches this agent to the room
 *   3. Agent reads room metadata to get the AI persona/instructions
 *   4. Agent uses Gemini for LLM, Google Cloud STT/TTS, and Silero for VAD
 *   5. When user leaves → agent sends transcript to /api/meetings/[id]/end-session
 *   6. Inngest picks up the event and generates a summary using Gemini
 *
 * Uses LiveKit Inference with Gemini 2.5 Flash Lite (no separate API key needed)
 * OR the Google plugin with your own GOOGLE_API_KEY / GEMINI_API_KEY.
 */

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    // Load VAD model once during prewarm for fast startup
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const vad = ctx.proc.userData.vad! as silero.VAD;

    // Parse room metadata to get agent instructions
    let instructions = "You are a helpful AI meeting assistant. Greet the user warmly and help them with their questions.";
    let agentName = "AI Assistant";

    try {
      const metadata = JSON.parse(ctx.room.metadata || "{}");
      if (metadata.instructions) {
        instructions = metadata.instructions;
      }
      if (metadata.agentName) {
        agentName = metadata.agentName;
      }
    } catch {
      console.log("[agent] No metadata found, using defaults");
    }

    console.log(`[agent] Joining room ${ctx.room.name} as "${agentName}"`);
    console.log(`[agent] Instructions: ${instructions.slice(0, 100)}...`);

    // Determine which API key approach to use
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    // Build the voice agent session
    // If we have a direct Gemini API key, use the Google plugin
    // Otherwise, use LiveKit Inference (no separate key needed)
    const sessionConfig: voice.AgentSessionOptions = {
      vad,
      // STT: Use LiveKit Inference Deepgram or Google plugin
      stt: geminiApiKey
        ? new google.STT({ apiKey: geminiApiKey })
        : "deepgram/nova-3",
      // LLM: Use Gemini 2.5 Flash Lite
      llm: geminiApiKey
        ? new google.LLM({ model: "gemini-2.5-flash-lite", apiKey: geminiApiKey })
        : "google/gemini-2.5-flash-lite",
      // TTS: Use Google plugin or LiveKit Inference
      tts: geminiApiKey
        ? new google.TTS({ apiKey: geminiApiKey })
        : "google/chirp-hd",
    };

    const session = new voice.AgentSession(sessionConfig);

    // Track conversation for transcript
    const transcript: string[] = [];

    session.on("agent_speech_committed", (ev) => {
      transcript.push(`[${agentName}]: ${ev.content}`);
    });

    session.on("user_speech_committed", (ev) => {
      transcript.push(`[User]: ${ev.content}`);
    });

    // Start the session
    await session.start({
      agent: new MeetAIAgent(instructions),
      room: ctx.room,
    });

    // Connect to the room
    await ctx.connect();

    // Generate initial greeting
    await session.generateReply({
      instructions: `Greet the user as "${agentName}". Introduce yourself based on your instructions and offer assistance.`,
    });

    // Handle room close — send transcript to Next.js API
    ctx.room.on("disconnected", async () => {
      console.log(`[agent] Room ${ctx.room.name} disconnected. Sending transcript...`);

      if (transcript.length > 0) {
        try {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
          const meetingId = ctx.room.name;

          await fetch(`${appUrl}/api/meetings/${meetingId}/end-session`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-agent-secret": process.env.AGENT_SECRET || "",
            },
            body: JSON.stringify({
              transcriptText: transcript.join("\n"),
            }),
          });
          console.log(`[agent] ✅ Transcript sent for meeting ${meetingId}`);
        } catch (err) {
          console.error("[agent] ❌ Failed to send transcript:", err);
        }
      }
    });
  },
});

// Run the agent worker
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "meetai-agent",
  })
);
