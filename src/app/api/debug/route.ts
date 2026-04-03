import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

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
    "GEMINI_API_KEY",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "NEXT_PUBLIC_LIVEKIT_URL",
    "BETTER_AUTH_SECRET",
    "DATABASE_URL",
  ] as const;

  for (const key of envChecks) {
    const val = process.env[key];
    results[`env:${key}`] = val
      ? { ok: true, message: `✅ Set (${val.slice(0, 8)}...)` }
      : { ok: false, message: `❌ MISSING — add to .env` };
  }

  // Also check GOOGLE_API_KEY as fallback for GEMINI_API_KEY
  if (!process.env.GEMINI_API_KEY && process.env.GOOGLE_API_KEY) {
    results["env:GEMINI_API_KEY"] = {
      ok: true,
      message: `✅ Using GOOGLE_API_KEY as fallback (${process.env.GOOGLE_API_KEY!.slice(0, 8)}...)`,
    };
  }

  // ── 2. Gemini API Key ────────────────────────────────────────────────────
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await model.generateContent("Reply with exactly: WORKING");
    const reply = result.response.text();
    results["gemini:model"] = {
      ok: true,
      message: `✅ Gemini API key valid — model replied: "${reply.trim()}"`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results["gemini:model"] = {
      ok: false,
      message: `❌ Gemini call failed: ${msg}`,
    };
  }

  // ── 3. LiveKit Cloud ─────────────────────────────────────────────────────
  try {
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const livekitUrl = process.env.LIVEKIT_URL!;
    const httpUrl = livekitUrl
      .replace("wss://", "https://")
      .replace("ws://", "http://");
    const roomService = new RoomServiceClient(
      httpUrl,
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!,
    );
    const rooms = await roomService.listRooms();
    results["livekit:cloud"] = {
      ok: true,
      message: `✅ LiveKit Cloud connected — ${rooms.length} active room(s)`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results["livekit:cloud"] = {
      ok: false,
      message: `❌ LiveKit error: ${msg}`,
    };
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
    message: `ℹ️ LiveKit webhook URL: ${appUrl}/api/webhook — configure this in LiveKit Cloud dashboard`,
  };

  // ── 6. Ngrok hint ────────────────────────────────────────────────────────
  results["ngrok:hint"] = {
    ok: true,
    message: "ℹ️ Run: npm run dev:webhook → webhook URL: https://nonnominalistic-impermanent-miss.ngrok-free.dev/api/webhook",
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
