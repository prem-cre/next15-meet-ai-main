import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * GET /api/debug
 *
 * Diagnostic endpoint — open in browser to verify the stack before testing.
 * Visit: http://localhost:3000/api/debug
 */
export async function GET() {
  const results: Record<string, { ok: boolean; message: string }> = {};

  // ── 1. Environment Variables ─────────────────────────────────────────────
  const requiredEnv = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "LIVEKIT_URL",
    "LIVEKIT_API_KEY",
    "LIVEKIT_API_SECRET",
    "NEXT_PUBLIC_LIVEKIT_URL",
    "AGENT_SECRET",
  ] as const;

  for (const key of requiredEnv) {
    const val = process.env[key];
    results[`env:${key}`] = val
      ? { ok: true, message: `✅ Set (${val.slice(0, 12)}...)` }
      : { ok: false, message: `❌ MISSING — add to .env` };
  }

  // Check Gemini API key (either name is fine)
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  results["env:GEMINI_API_KEY"] = geminiKey
    ? { ok: true, message: `✅ Set (${geminiKey.slice(0, 12)}...)` }
    : { ok: false, message: "❌ MISSING — add GEMINI_API_KEY or GOOGLE_API_KEY to .env" };

  // ── 2. Gemini API ────────────────────────────────────────────────────────
  if (geminiKey) {
    try {
      const genAI = new GoogleGenerativeAI(geminiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const result = await model.generateContent("Reply with exactly: WORKING");
      const reply = result.response.text().trim();
      results["gemini:api"] = {
        ok: true,
        message: `✅ Gemini API key valid — model replied: "${reply.slice(0, 40)}"`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results["gemini:api"] = {
        ok: false,
        message: `❌ Gemini call failed: ${msg.slice(0, 120)}`,
      };
    }
  } else {
    results["gemini:api"] = {
      ok: false,
      message: "❌ Skipped — no Gemini API key",
    };
  }

  // ── 3. LiveKit Connection ────────────────────────────────────────────────
  try {
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const httpUrl = (process.env.LIVEKIT_URL || "")
      .replace("wss://", "https://")
      .replace("ws://", "http://");
    const svc = new RoomServiceClient(
      httpUrl,
      process.env.LIVEKIT_API_KEY!,
      process.env.LIVEKIT_API_SECRET!
    );
    const rooms = await svc.listRooms();
    results["livekit:cloud"] = {
      ok: true,
      message: `✅ LiveKit Cloud connected — ${rooms.length} active rooms`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results["livekit:cloud"] = {
      ok: false,
      message: `❌ LiveKit error: ${msg.slice(0, 120)}`,
    };
  }

  // ── 4. Database ──────────────────────────────────────────────────────────
  try {
    const { db } = await import("@/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    results["database"] = { ok: true, message: "✅ Neon database connected" };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    results["database"] = { ok: false, message: `❌ Database error: ${msg}` };
  }

  // ── 5. LiveKit token endpoint ────────────────────────────────────────────
  results["livekit:token_endpoint"] = {
    ok: true,
    message: "ℹ️ Token endpoint: /api/livekit/token?room=ROOM_ID",
  };

  // ── 6. Agent instructions ────────────────────────────────────────────────
  results["agent:info"] = {
    ok: true,
    message: `ℹ️ Start agent: cd agent && npm run dev  |  AGENT_SECRET: ${
      process.env.AGENT_SECRET ? "set ✅" : "MISSING ❌"
    }`,
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
