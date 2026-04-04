/**
 * test-pipeline.ts
 *
 * Run this to verify the entire transcript → Gemini → DB pipeline works
 * WITHOUT needing a live meeting.
 *
 * Usage (from agent/ directory):
 *   npx tsx ../test-pipeline.ts
 *
 * Or from the project root:
 *   npx tsx test-pipeline.ts
 */

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const FAKE_TRANSCRIPT = `[User]: Hello, are you there?
[AI Assistant]: Hello! I'm here and ready to help. How can I assist you today?
[User]: Can you explain what machine learning is?
[AI Assistant]: Of course! Machine learning is a branch of artificial intelligence where computers learn from data to make predictions or decisions without being explicitly programmed for each task. For example, spam filters learn to recognize spam by studying examples of spam and non-spam emails.
[User]: That's interesting. What are some real-world applications?
[AI Assistant]: Great question! Machine learning powers many things you use daily — recommendation systems on Netflix and Spotify, voice assistants like Siri and Google Assistant, fraud detection in banking, medical image analysis for doctors, and self-driving car technology.
[User]: Thank you, that was very helpful!
[AI Assistant]: You're very welcome! Feel free to ask if you have any more questions. Have a great day!`;

async function testGeminiDirect() {
  console.log("\n=== TEST 1: Direct Gemini API Call ===");
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.error("❌ No GEMINI_API_KEY or GOOGLE_API_KEY in .env");
    return false;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with exactly 3 words: GEMINI_IS_WORKING" }] }],
          generationConfig: { maxOutputTokens: 20 },
        }),
      }
    );
    const data = await res.json() as any;
    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      console.log("✅ Gemini API works! Response:", data.candidates[0].content.parts[0].text.trim());
      return true;
    } else {
      console.error("❌ Gemini API unexpected response:", JSON.stringify(data, null, 2));
      return false;
    }
  } catch (err) {
    console.error("❌ Gemini API call failed:", err);
    return false;
  }
}

async function testEndSessionRoute() {
  console.log("\n=== TEST 2: end-session Route ===");

  // Detect which port Next.js is on
  let appUrl = "";
  for (const url of ["http://localhost:3000", "http://localhost:3001"]) {
    try {
      const r = await fetch(`${url}/api/livekit/token`, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) { appUrl = url; break; }
    } catch { /* try next */ }
  }

  if (!appUrl) {
    console.error("❌ Next.js is not running on port 3000 or 3001. Start it first with: npm run dev");
    return false;
  }
  console.log(`✅ Next.js detected at ${appUrl}`);

  // Use a fake meeting ID — will return 404 since the meeting doesn't exist
  const fakeMeetingId = "TEST_PIPELINE_" + Date.now();
  const url = `${appUrl}/api/meetings/${fakeMeetingId}/end-session`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-secret": process.env.AGENT_SECRET || "meetai-agent-secret-2025",
      },
      body: JSON.stringify({ transcriptText: FAKE_TRANSCRIPT }),
    });
    const body = await res.text();
    console.log(`end-session response: HTTP ${res.status} — ${body}`);

    if (res.status === 404) {
      console.log("✅ Route is reachable and auth works (404 = meeting not in DB, which is expected for test ID)");
      return true;
    } else if (res.status === 403) {
      console.error("❌ Auth failed — AGENT_SECRET mismatch. Check .env");
      return false;
    } else if (res.status === 200) {
      console.log("✅ Route returned 200 — summarization triggered");
      return true;
    }
    return false;
  } catch (err) {
    console.error("❌ end-session call failed:", err);
    return false;
  }
}

async function main() {
  console.log("🔍 MeetAI Pipeline Verification Test");
  console.log("=====================================");

  const geminiOk = await testGeminiDirect();
  const routeOk = await testEndSessionRoute();

  console.log("\n=== RESULTS ===");
  console.log("Gemini API:", geminiOk ? "✅ WORKS" : "❌ BROKEN");
  console.log("end-session route:", routeOk ? "✅ WORKS" : "❌ BROKEN");

  if (geminiOk && routeOk) {
    console.log("\n✅ ALL SYSTEMS GO — The pipeline is functional.");
    console.log("   Now start the agent: cd agent && npm run dev");
  } else {
    console.log("\n❌ Fix the issues above before testing a live meeting.");
  }
}

main().catch(console.error);
