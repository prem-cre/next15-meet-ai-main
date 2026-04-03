# Meet.AI — Enterprise LiveKit & Next.js Architecture Guide

Built for real-time AI capabilities, **Meet.AI** is a robust video call application incorporating autonomous multimodal AI agents in live meeting sessions. Our architecture bridges **Next.js 15**, **LiveKit Cloud**, and **Google Gemini 2.5 Flash Native Audio** to create ultra-low latency voice experiences alongside human participants.

This document serves as the **Senior Engineer Blueprint** for the project. It covers the complete structure, event-driven pipelines, complex edge-cases resolved during development, and the step-by-step setup flow for environments and developers onboarding onto this project.

---

## 🏗️ 1. High-Level Architecture & Lifecycle Flow

Meet.AI operates on a highly decoupled architecture separating core application UI/state from the autonomous Agent Worker.

### 🌟 1.1 Components
- **Frontend App**: Next.js 15 App Router (`/src`). Handles UI, real-time WebRTC grid via `@livekit/components-react`, user authentication (Better Auth), and state management.
- **Webhook Gateway**: Server-side Next.js route (`/src/app/api/webhook/route.ts`). Listens to LiveKit control plane events to orchestrate meeting states.
- **Agent Worker**: Standalone Node.js process (`/agent`). Uses `@livekit/agents` to parse audio/video streams, transcribe speech, route logic through Google's Gemini Multimodal models, and synthesize real-time voice responses.
- **Database**: Serverless PostgreSQL via Neon. Managed by Drizzle ORM.
- **Background Jobs**: Inngest (`/src/inngest/client.ts`). Manages heavy post-meeting execution, specifically generating executive summaries via Gemini from raw session transcripts.

### 🔄 1.2 The Complete "Agent Join" Pipeline
To successfully have an AI talk in a meeting, the following synchronous flow happens:
1. **Meeting Creation**: The human initiates a meeting (`src/modules/meetings/server/procedures.ts`). DB record is set to `status: "upcoming"`.
2. **Participant Joins**: The browser connects to the LiveKit Room WebSocket.
3. **Webhook Triggered**: LiveKit Cloud fires a `participant_joined` event back to our Next.js backend (`/api/webhook/route.ts`).
4. **Agent Summoning**: The webhook verifies the signature, marks the meeting `"active"`, and calls `agentDispatchService.createDispatch()` to assign the `meetai-agent` worker to the room.
5. **Worker Pickup**: The running `agent/src/agent.ts` daemon connects to LiveKit Cloud via WebSocket, picks up the dispatched room `Job`, executes its `entry` function, and bridges the Gemini model to the audio pipeline.
6. **Room Termination**: When the room clears, the Agent's `disconnected` event fires, submitting the live transcript to Next.js (`/end-session`), effectively creating a background `Inngest` job to write the summary.

---

## 🧩 2. Core Dependencies & Tooling

When onboarding or building new features, interact dynamically within this exact stack:

- **Next.js 15, React 19**
- **LiveKit Server SDK (`livekit-server-sdk`) & React Components (`@livekit/components-react`)**
- **LiveKit Agents (`@livekit/agents`, `@livekit/agents-plugin-google`, `@livekit/agents-plugin-silero`ing)**
- **Google Generative AI (Gemini Live API)**
- **Tailwind CSS v4 & shadcn/ui**
- **Drizzle ORM & Postgres (Neon)**
- **Better Auth**
- **Inngest (Background Task Orchestration)**
- **Polar (Subscription & Payments)**

---

## 🛠️ 3. Developer Onboarding & Local Setup

### Step 1: Virtual Environment Isolation
We **strongly** advise creating a standard Node Virtual Environment setup or ensuring `package.json` resolutions don't pollute global scopes. All node module installations should occur inside the respective directories.

### Step 2: Install Packages 
The project has dual-package locations:
```bash
# 1. Install root dependencies (use legacy-peer-deps gracefully if React 19 conflicts arise)
npm install --legacy-peer-deps

# 2. Install Agent Worker dependencies
cd agent
npm install
```

### Step 3: Secrets & Environments
Create `.env` using `.env.example` at the **root** folder.
The `agent/src/agent.ts` natively reaches into the root `../.env` allowing total configuration from a central point.
Required blocks:
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
- `GOOGLE_API_KEY` or `GEMINI_API_KEY` (Required for Multimodal API)
- `AGENT_SECRET` (Shared token for `/end-session`)

### Step 4: Run the Environment
A complete local environment requires multiple terminal sessions:
```bash
# Terminal 1: Next.js Frontend & Next.js API
npm run dev

# Terminal 2: Agent Worker (Run from the /agent folder)
cd agent
npm run dev

# Terminal 3: Webhook Tunnel (For LiveKit cloud to ping your localhost)
# Use ngrok locally on port 3000 to pipe webhooks to /api/webhook
ngrok http 3000

# Terminal 4: Inngest Background Worker (Optional unless testing post-meeting processing)
npx inngest-cli@latest dev
```

---

## 🛑 4. Diagnostic Case Studies: Handling Edge Cases & Complexities

As the system integrates heavily distributed SDKs (Websockets to LiveKit + Webhooks from LiveKit + Google API + FFMpeg), failures demand granular awareness. Here is how previous complex system crashes were handled, specifically regarding the "Silent AI Agent" behavior.

### 🐛 Case 1: Webhook Signature Checksum Mismatches (Windows / Cross-Platform Encoding)
**Symptoms:** `LiveKit Webhook Receiver` throws `❌ Signature verification failed: Error: sha256 checksum of body does not match`
**Diagnosis:** In Next.js App router (`req.text()`), body normalization might convert CR/LF bytes or alter encoding dynamically causing hash generation mismatch against LiveKit's token header.
**Solution Applied:** Extract raw `ArrayBuffer` natively from `NextRequest`, strictly encode as `utf-8` using Node's native `Buffer`. 
```typescript
const rawBody = await req.arrayBuffer();
const body = Buffer.from(rawBody).toString("utf-8");
const event = await receiver.receive(body, authHeader);
```

### 🐛 Case 2: Frontend "Maximum Update Depth Exceeded" Re-render Loops
**Symptoms:** Meeting frontend hangs completely, component flashes, browser console logs recursive stack trace in `call-connect.tsx`. 
**Diagnosis:** Token fetching dependencies triggering setState which in turn trigger re-evaluations inside `useEffect`. A classic race condition when dealing with dynamic WebRTC tokens.
**Solution Applied:** Dependency flattening in `useEffects`. Handled object stability by omitting volatile external state objects and enforcing robust unmount flag tokens (`isCancelled` properties on async chains).

### 🐛 Case 3: The "Silent Worker" (Agent Refuses to Join Room Despite Dispatch)
**Symptoms:** Human joins, Webhook creates a LiveKit dispatch, but the AI Agent is not visible. Console reports no error. 
**Diagnosis Pipeline:**
1. **Agent Start Logs:** Confirm worker successfully initializes (`edition: "Cloud", version: ...`).
2. **Missing `voice` namespace:** If the import is lost during codebase refactors, standard LiveKit events won't fire. (Ensured `voice` imports natively from `@livekit/agents`).
3. **FFmpeg Spawn Failures:** In Windows (`EFTYPE` or `EPIPE`), `ffmpeg-static` requires strict path loading.
4. **Environment Pathing Gap:** Fixed root loading issues; the `agent` inherently assumes its root folder is its boundary. Absolute `cwd` bindings were written to ensure the root `.env` parsed regardless of script invocation source.
5. **Race Condition Check:** A previous problem allowed `participant_left` (when a human refreshes the page) to prematurely trigger `status === 'processing'`, locking the room before the Agent could finalize the Websocket sync. The webhook logic is now guarded.

---

## 🔍 5. Expanding Features & Workflows

If you wish to modify or expand the system:
1. **Adding New Agent Instructions:** Alter the `ctx.room.metadata` JSON schema when generating the token natively on `server/procedures.ts`. `MeetAIAgent` dynamically maps metadata properties at boot time.
2. **Experimenting with New LLMs:** Swap `google.beta.realtime.RealtimeModel` inside `agent/src/agent.ts` to standard `llm: new openai.LLM()` if preferring standard Speech-To-Text/Text-To-Speech bridging instead of native Multimodal audio mapping. Ensure `stt` and `tts` configurations are appropriately mapped to `voice.AgentSessionOptions`.
3. **Database Changes:** Modifying schemas in `src/db/schema.ts` requires running:
   ```bash
   npx drizzle-kit push
   ```

*Documentation strictly curated for robust agentic operation. Refer to LiveKit Agent frameworks for more localized sub-plugin references.*
