import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * GET /api/debug
 * 
 * Diagnostic endpoint — open this in your browser to verify every
 * piece of the stack is configured correctly BEFORE testing a meeting.
 * 
 * Visit: http://localhost:3000/api/debug
 */
export async function GET() {
  const results: Record<string, { ok: boolean; message: string }> = {};

  // ── 1. Environment Variables ─────────────────────────────────────────────
  const envChecks = [
    "OPENAI_API_KEY",
    "NEXT_PUBLIC_STREAM_VIDEO_API_KEY",
    "STREAM_VIDEO_SECRET_KEY",
    "BETTER_AUTH_SECRET",
    "DATABASE_URL",
  ] as const;

  for (const key of envChecks) {
    const val = process.env[key];
    results[`env:${key}`] = val
      ? { ok: true, message: `✅ Set (${val.slice(0, 8)}...)` }
      : { ok: false, message: `❌ MISSING — add to .env` };
  }

  // ── 2. OpenAI API Key ────────────────────────────────────────────────────
  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 10,
      messages: [{ role: "user", content: "Reply with exactly: WORKING" }],
    });
    const reply = response.choices[0]?.message?.content ?? "";
    results["openai:gpt4o"] = {
      ok: true,
      message: `✅ API key valid — model replied: "${reply.trim()}"`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results["openai:gpt4o"] = {
      ok: false,
      message: `❌ OpenAI call failed: ${msg}`,
    };
  }

  // ── 3. Stream Video Client ───────────────────────────────────────────────
  try {
    const { StreamClient } = await import("@stream-io/node-sdk");
    const client = new StreamClient(
      process.env.NEXT_PUBLIC_STREAM_VIDEO_API_KEY!,
      process.env.STREAM_VIDEO_SECRET_KEY!
    );
    // Simple token generation to verify keys are valid
    client.generateUserToken({ user_id: "debug-test", validity_in_seconds: 60 });
    results["stream:video"] = { ok: true, message: "✅ Stream Video keys valid (token generated)" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results["stream:video"] = { ok: false, message: `❌ Stream Video error: ${msg}` };
  }

  // ── 4. Database connection ───────────────────────────────────────────────
  try {
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    results["database"] = { ok: true, message: "✅ Database connected" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results["database"] = { ok: false, message: `❌ Database error: ${msg}` };
  }

  // ── 5. Webhook URL Check ─────────────────────────────────────────────────
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  results["webhook:url"] = {
    ok: true,
    message: `ℹ️ Your webhook URL for Stream Dashboard: ${appUrl}/api/webhook — make sure ngrok forwards to this`,
  };

  // ── 6. Ngrok hint ────────────────────────────────────────────────────────
  results["ngrok:hint"] = {
    ok: true,
    message: "ℹ️ Run: npm run dev:webhook  →  ngrok URL: https://nonnominalistic-impermanent-miss.ngrok-free.dev/api/webhook",
  };

  const allOk = Object.values(results).every((r) => r.ok);
  const failCount = Object.values(results).filter((r) => !r.ok).length;

  return NextResponse.json(
    {
      status: allOk ? "ALL CHECKS PASSED ✅" : `${failCount} CHECK(S) FAILED ❌`,
      timestamp: new Date().toISOString(),
      checks: results,
    },
    { status: allOk ? 200 : 500 }
  );
}
