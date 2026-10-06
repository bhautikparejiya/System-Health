import { NextResponse } from "next/server";
import { q } from "@/lib/db";

/** Deployment self-check: reports which settings are present (never their values) and whether the database works. */
export async function GET() {
  const names = ["APP_BASE_URL", "GHL_CLIENT_ID", "GHL_CLIENT_SECRET", "GHL_SHARED_SECRET", "SESSION_SECRET", "CRON_SECRET", "ACTION_SECRET", "DATABASE_URL"];
  const configured = Object.fromEntries(names.map((n) => [n, !!process.env[n]]));
  let database = "ok";
  let installations: number | null = null;
  try {
    const rows = await q<{ n: string }>(`select count(*)::text as n from installations`);
    installations = Number(rows[0]?.n ?? 0);
  } catch (e) {
    database = `error: ${(e as Error).message}`;
  }
  return NextResponse.json({ configured, database, installations, mock: process.env.GHL_MOCK === "true" });
}
