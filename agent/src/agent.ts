import {
  type JobContext,
  ServerOptions,
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

console.log("[agent] LIVEKIT_URL:", process.env.LIVEKIT_URL);
console.log("[agent] GOOGLE_API_KEY:", process.env.GOOGLE_API_KEY ? "EXISTS" : "MISSING");
console.log("[agent] AGENT_SECRET:", process.env.AGENT_SECRET ? "EXISTS" : "MISSING");

// Agent class — extends LiveKit voice.Agent with dynamic instructions
class MeetAIAgent extends voice.Agent {
  constructor(instructions: string) {
    super({
      instructions: instructions || "You are a helpful AI meeting assistant.",
    });
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    // Connect first so room.name is populated
    await ctx.connect();
    console.log(`[agent] ✅ Connected to room: ${ctx.room.name}`);

    // Parse room metadata for custom persona + instructions
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

    const geminiApiKey =
      process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
    const transcript: string[] = [];

    // gemini-2.5-flash-native-audio-preview-12-2025 is the current working model
    // for Gemini Developer API (bidiGenerateContent / Live API)
    // gemini-2.0-flash-exp was deprecated by Google and removed
    const session = new voice.AgentSession({
      llm: new google.beta.realtime.RealtimeModel({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        apiKey: geminiApiKey,
        voice: "Puck",
        temperature: 0.8,
      }),
    });

    // Collect transcript lines for the post-meeting summary
    session.on("user_speech_committed", (ev: any) => {
      if (ev?.transcript) {
        transcript.push(`[User]: ${ev.transcript}`);
      }
    });
    session.on("agent_speech_committed", (ev: any) => {
      if (ev?.transcript) {
        transcript.push(`[${agentName}]: ${ev.transcript}`);
      }
    });

    await session.start({
      agent: new MeetAIAgent(instructions),
      room: ctx.room,
    });
    console.log("[agent] ✅ Session started");

    // Greet the user
    await session.generateReply({
      instructions: `Greet the user warmly as "${agentName}". Introduce yourself based on your instructions and offer assistance.`,
    });
    console.log("[agent] ✅ Greeting sent");

    // When the room closes: push transcript to our Next.js API
    ctx.room.on("disconnected", async () => {
      const roomName = ctx.room.name;
      console.log(
        `[agent] Room "${roomName}" closed. Transcript lines: ${transcript.length}`
      );
      if (transcript.length === 0) return;

      try {
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
        const res = await fetch(
          `${appUrl}/api/meetings/${roomName}/end-session`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-agent-secret": process.env.AGENT_SECRET || "",
            },
            body: JSON.stringify({ transcriptText: transcript.join("\n") }),
          }
        );
        console.log(`[agent] ✅ Transcript sent — HTTP ${res.status}`);
      } catch (err) {
        console.error(`[agent] ❌ Failed to send transcript:`, err);
      }
    });
  },
});

// Boot the agent worker
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "meetai-agent",
  })
);
