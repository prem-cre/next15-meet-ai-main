import { voice } from "@livekit/agents";

/**
 * MeetAI Agent — extends the LiveKit voice.Agent class.
 * Instructions are set dynamically from room metadata per meeting.
 */
export class MeetAIAgent extends voice.Agent {
  constructor(instructions: string) {
    super({
      instructions: instructions || "You are a helpful AI meeting assistant.",
    });
  }
}
