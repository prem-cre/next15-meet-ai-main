# 🚀 MeetAI — Complete Startup Guide

## ⚠️ FIRST TIME ONLY: Clean Install the Agent

The agent has native dependencies. Run this ONCE to ensure they're installed correctly:

```powershell
cd "C:\Users\mahan\Documents\me\next15-meet-ai\agent"
.\clean-install.bat
```

This deletes old `node_modules` (which may have a broken silero/rtc-node) and reinstalls fresh.

---

## ⚡ Every Time: Start 3 Terminals

### Terminal 1 — Next.js App
```powershell
# Kill any leftover node processes first!
taskkill /F /IM node.exe 2>$null

cd "C:\Users\mahan\Documents\me\next15-meet-ai"
npm run dev
```
App → http://localhost:3000

### Terminal 2 — LiveKit Agent
```powershell
cd "C:\Users\mahan\Documents\me\next15-meet-ai\agent"
npm run dev
```

Wait for this in the agent terminal:
```
[agent] GOOGLE_API_KEY: ✅ EXISTS
registered worker
```

### Terminal 3 — Inngest Dev Server (for post-meeting summaries)
```powershell
cd "C:\Users\mahan\Documents\me\next15-meet-ai"
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

---

## 🔍 Verify Everything Works

Open in browser after starting all 3 terminals:
```
http://localhost:3000/api/debug
```
ALL checks must show ✅

---

## ✅ How a Meeting Works End-to-End

1. Start all 3 terminals
2. Open http://localhost:3000/api/debug — verify all ✅
3. Sign in at http://localhost:3000
4. Create an Agent (give it instructions, e.g. "You are a math tutor")
5. Create a Meeting and assign that agent
6. Click Start → Join Call
7. **Agent joins within 5–10 seconds and greets you**
8. Have a conversation
9. When done, click Leave Call (the X button in controls)
10. Within 30 seconds you should see in the Next.js terminal:
    ```
    [end-session] 📝 Meeting <id> — transcript: 843 chars
    [end-session] ✅ Meeting <id> marked as processing
    [end-session] 🚀 Inngest triggered for meeting <id>
    ```
11. Go to Meetings → select the meeting → Summary tab
12. Summary appears within 30–60 seconds

---

## ❗ Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Agent doesn't appear in call | Agent terminal not running | Start Terminal 2 |
| Agent terminal shows ENOTFOUND | Intermittent network hiccup | It auto-retries — wait 15s |
| Agent appears but doesn't speak | GOOGLE_API_KEY missing/wrong | Check .env has correct key |
| "No transcript recorded" in summary | Agent transcript events not firing | Ensure you actually SPOKE in the call |
| Meeting stuck "Processing" | Inngest not running | Start Terminal 3 |
| Port 3000 in use | Old node process | Run `taskkill /F /IM node.exe` first |
| `@livekit/rtc-node` error | Native install broken | Run `agent\clean-install.bat` |

---

## 🔑 Tech Stack

| Feature | Technology |
|---------|------------|
| Frontend | Next.js 15 + LiveKit React SDK |
| Real-time calls | LiveKit Cloud |
| Agent voice | Gemini 2.0 Flash Realtime |
| Post-meeting summary | Gemini 1.5 Flash via Inngest |
| Database | Neon (Postgres) + Drizzle ORM |
| Auth | Better Auth |
| Subscriptions | Polar |

---

## 🔑 Required .env Values

```env
DATABASE_URL="postgresql://..."
BETTER_AUTH_SECRET="..."
BETTER_AUTH_URL="http://localhost:3000"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
GOOGLE_API_KEY="AIza..."         ← Your Gemini API key
GEMINI_API_KEY="AIza..."         ← Same key, different name (agent uses both)
LIVEKIT_URL="wss://..."
LIVEKIT_API_KEY="API..."
LIVEKIT_API_SECRET="..."
NEXT_PUBLIC_LIVEKIT_URL="wss://..."
AGENT_SECRET="meetai-agent-secret-2025"
POLAR_ACCESS_TOKEN="polar_oat_..."
```
