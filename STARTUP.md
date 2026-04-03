# Meet.AI — Technical Documentation & System Overview

## 1. Architecture Overview
Meet.AI is a real-time AI meeting assistant platform built on **Next.js 15**, **LiveKit Cloud**, and **Google Gemini 2.x**. The system is designed to provide ultra-low latency, multimodal voice interactions and automated post-meeting intelligence (summaries and transcripts).

### High-Level Flow
1. **Meeting Creation**: Next.js server creates a LiveKit Room and initializes metadata (persona name, instructions) in the database.
2. **Real-time Session**:
   - When a human joins, a **LiveKit Webhook** triggers the **Agent Worker**.
   - The Agent joins as a participant and connects via the **Gemini Live API (Multimodal)**.
   - Conversation is handled by a native-audio model with custom **STT Turn Detection** for human-like interruption handling.
3. **Processing**:
   - Upon participant departure, the Agent submits the full transcript to our `/end-session` API.
   - **Inngest** triggers a background job to generate an executive summary using Gemini.
   - The final transcript and summary are stored in the Postgres (Neon) database.

---

## 2. Core Service Directory (`src/`)

### API Routes & Webhooks
- `src/app/api/webhook/route.ts`: The central nervous system for LiveKit events.
  - `participant_joined`: Activates the meeting and dispatches the AI agent.
  - `participant_left`: Handles session cleanup.
  - `egress_ended`: Saves final recording/transcript URLs.
- `src/app/api/livekit/token/route.ts`: Issues JWT tokens for human participants.
- `src/app/api/meetings/[meetingId]/end-session/route.ts`: Internal endpoint used by the AI Agent to submit transcripts after a call finishes. Secured by `x-agent-secret`.

### Modules (Shared UI & Logic)
- `src/modules/call/`: Frontend meeting interface.
  - `ui/components/call-active.tsx`: The main meeting grid. Includes `Microphone` sources for AI visibility.
  - `ui/components/call-connect.tsx`: Handles Token fetching and initial room connection.
- `src/modules/meetings/`: Management and post-call analytics.
  - `server/procedures.ts`: tRPC mutations for meeting lifecycle (Create, Update, Remove).

---

## 3. AI Agent Worker (`agent/`)

The agent is a standalone Node.js process using the `@livekit/agents` framework.

### Key Components
- `agent/src/agent.ts`: The entry point for the worker.
  - Uses `google.beta.realtime.RealtimeModel` for native audio LLM logic.
  - Implements `MultilingualModel` turn detection to allow users to interrupt the AI naturally.
  - Handles the `disconnected` event to push the transcript to the backend.
- `agent/src/meet-agent.ts`: A specialized extension of the `voice.Agent` class that initializes instructions dynamicallly from room metadata.

#### Environment Variables for Agent
- `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`: LiveKit connection info.
- `GOOGLE_API_KEY`: Required for Gemini Realtime API.
- `AGENT_SECRET`: Shared secret used to authenticate with the backend `/end-session` API.

---

## 4. Stability & Lifecycle Fixes (Current State)

### Fix: Agent Joining (Dispatch)
We transition from "dispatch-on-create" to **"dispatch-on-join"**. The agent is now summoned by the `participant_joined` webhook. For local development robustness, we've also wired the human join logic to verify if an agent dispatch is needed if the webhook isn't reachable from LiveKit Cloud.

### Fix: Hydration & Rendering
- **Root Layout Mismatch**: Fixed by moving provider components inside the `<body>` tag.
- **Infinite Effect Loops**: Stabilized `useEffect` hooks across `call-connect.tsx` and `sidebar.tsx` by ensuring stable dependency arrays and implementing cancellation logic for unmounted components.

---

## 5. Development Guide

### Prerequisites
- Node.js 20+
- LiveKit Cloud account
- Google Gemini API Key

### Setup Instructions
1. Install dependencies: `npm install` (root) and `cd agent && npm install`.
2. Configure `.env`: Copy `.env.example`, fill in LiveKit and Google keys.
3. Run the stack:
   ```bash
   # Terminal 1: Next.js Frontend
   npm run dev

   # Terminal 2: AI Agent Worker
   cd agent
   npm run dev
   ```

### Troubleshooting
- **Agent not joining**: Verify your `LIVEKIT_URL` matches between `.env` and `agent/.env`. Ensure the agent worker process is running and showing `edition: Cloud` in logs.
- **Transcript missing**: Check `AGENT_SECRET` consistency. Verify that your local dev server is accessible if testing webhooks (use `ngrok` for `egress_ended` events).
