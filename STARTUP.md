# 🚀 MeetAI — Complete Startup Guide

## ⚡ EVERY TIME You Run the App: 3 Terminals Required

---

## Terminal 1 — Next.js App
```bash
cd "C:\Users\mahan\Documents\me\next15-meet-ai"
npm run dev
```
App → http://localhost:3000

---

## Terminal 2 — ngrok Tunnel (AGENT WON'T JOIN WITHOUT THIS)
```bash
cd "C:\Users\mahan\Documents\me\next15-meet-ai"
npm run dev:webhook
```
This runs ngrok at your static URL:
**https://nonnominalistic-impermanent-miss.ngrok-free.dev**

---

## Terminal 3 — Inngest Dev Server (for post-meeting summaries)
```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

---

## 🔍 Step 1: Verify Everything Works (DO THIS FIRST)

Open this in your browser AFTER starting all 3 terminals:
```
http://localhost:3000/api/debug
```
You'll see a JSON response showing ✅ or ❌ for each system.
ALL checks must show ✅ before testing meetings.

---

## 🔧 One-Time Setup: Stream Dashboard Webhook (CRITICAL)

This is the MOST IMPORTANT step. Without it, the agent NEVER joins.

1. Go to https://dashboard.getstream.io
2. Select your app (API key: `wftqsyu83p2d`)
3. Go to **Video & Audio → Webhooks**
4. Add/Update webhook:
   - **URL**: `https://nonnominalistic-impermanent-miss.ngrok-free.dev/api/webhook`
   - **Enable these events** (check all):
     - ✅ `call.session_started`
     - ✅ `call.session_participant_left`
     - ✅ `call.session_ended`
     - ✅ `call.transcription_ready`
     - ✅ `call.recording_ready`
5. Save webhook.

> ✅ Since you have a static ngrok domain, you only need to do this ONCE.

---

## ✅ How to Test the Agent is Working

1. Start all 3 terminals above
2. Open http://localhost:3000/api/debug — all must be ✅
3. Sign in to http://localhost:3000
4. Create an Agent (Agents tab)
5. Create a Meeting, assign that agent
6. Start the meeting, allow mic + camera, click Join
7. **Watch your Terminal 1 (Next.js) logs** — you should see:
   ```
   [webhook] 📨 Received event: call.session_started
   [webhook] ✅ Meeting found: ...
   [webhook] 🤖 Connecting agent: ...
   [webhook] ✅ connectOpenAi succeeded
   [webhook] 📌 realtimeClient stored
   ```
8. Within 5 seconds the agent appears in the call and starts talking

---

## ❗ Common Issues & Fixes

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| Agent never joins, no webhook logs | Stream Dashboard webhook not set | Set webhook URL in Stream Dashboard (step above) |
| Webhook logs show but agent doesn't speak | OpenAI key invalid/no credits | Check http://localhost:3000/api/debug |
| `[webhook] ❌ Signature verification failed` | Wrong `STREAM_VIDEO_SECRET_KEY` | Verify key in .env matches Stream Dashboard |
| `[webhook] ❌ Meeting not found` | Meeting status wrong in DB | Delete old meetings, create a fresh one |
| Inngest shows no events after joining | Normal! Inngest only runs AFTER meeting ends | This is correct behaviour |
| Meeting stuck "processing" | Inngest dev server not running | Start Terminal 3 |

---

## 🔑 Required .env Values

```env
DATABASE_URL="postgresql://..."
BETTER_AUTH_SECRET="..."
BETTER_AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
GITHUB_CLIENT_ID="..."
GITHUB_CLIENT_SECRET="..."
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
NEXT_PUBLIC_STREAM_VIDEO_API_KEY="..."
STREAM_VIDEO_SECRET_KEY="..."
NEXT_PUBLIC_STREAM_CHAT_API_KEY="..."
STREAM_CHAT_SECRET_KEY="..."
OPENAI_API_KEY="sk-..."
POLAR_ACCESS_TOKEN="..."
```
