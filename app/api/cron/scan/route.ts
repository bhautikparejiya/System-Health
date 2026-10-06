import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { env } from "@/lib/env";
import { scanLocation, tryLockLocation } from "@/lib/scan";

export const maxDuration = 60;

const SCAN_INTERVAL_MINUTES = 14;
const TIME_BUDGET_MS = 45_000;
const PARALLEL = 3;

/**
 * Scans the locations that are due. Call every 15 minutes from an external scheduler
 * (cron-job.org or GitHub Actions) with header  Authorization: Bearer <CRON_SECRET>  or  ?key=<CRON_SECRET>.
 * Vercel Cron (once a day on the Hobby plan) calls it with the same header automatically.
 */
async function handle(req: Request) {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization");
  const ok = env.cronSecret && (auth === `Bearer ${env.cronSecret}` || url.searchParams.get("key") === env.cronSecret);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  const due = await q<{ location_id: string }>(
    `select location_id from installations
      where (last_scanned_at is null or last_scanned_at < now() - make_interval(mins => $1))
        and (scan_lock_until is null or scan_lock_until < now())
      order by last_scanned_at asc nulls first
      limit 50`,
    [SCAN_INTERVAL_MINUTES],
  );

  const done: string[] = [];
  const failed: string[] = [];
  let next = 0;
  async function worker() {
    while (next < due.length && Date.now() - started < TIME_BUDGET_MS) {
      const loc = due[next++].location_id;
      if (!(await tryLockLocation(loc))) continue;
      try {
        await scanLocation(loc);
        done.push(loc);
      } catch (e) {
        console.error(`[cron] scan ${loc} failed`, e);
        failed.push(loc);
        await q(`update installations set last_scanned_at = now() where location_id = $1`, [loc]); // back off until next interval
      }
    }
  }
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return NextResponse.json({ due: due.length, scanned: done.length, failed: failed.length, ms: Date.now() - started });
}

export const GET = handle;
export const POST = handle;
