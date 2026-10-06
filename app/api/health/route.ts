import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { latestScan, scanLocation, tryLockLocation } from "@/lib/scan";

export const maxDuration = 60;

/** Latest health result for a location. Runs a first scan synchronously if none exists yet. */
export async function GET(req: Request) {
  const locationId = new URL(req.url).searchParams.get("locationId");
  const access = await authorize(req, locationId);
  if (!access || !locationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let scan = await latestScan(locationId);
  if (!scan && (await tryLockLocation(locationId))) scan = await scanLocation(locationId);

  const inst = await q1(`select location_name from installations where location_id = $1`, [locationId]);
  const history = await q<{ day: string; score: number }>(
    `select day, score from score_history where location_id = $1 and day >= current_date - 29 order by day`,
    [locationId],
  );
  return NextResponse.json({
    locationName: inst?.location_name ?? null,
    scan,
    history: history.map((h) => ({ day: new Date(h.day).toISOString().slice(0, 10), score: Number(h.score) })),
    readOnly: access.kind === "embed",
  });
}

/** "Scan now" button. */
export async function POST(req: Request) {
  const locationId = new URL(req.url).searchParams.get("locationId");
  const access = await authorize(req, locationId);
  if (!access || access.kind !== "session" || !locationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const last = await q1(`select scanned_at from scans where location_id = $1`, [locationId]);
  if (last && Date.now() - new Date(last.scanned_at).getTime() < 60_000) {
    return NextResponse.json({ scan: await latestScan(locationId), throttled: true });
  }
  if (!(await tryLockLocation(locationId))) return NextResponse.json({ error: "A scan is already running" }, { status: 409 });
  return NextResponse.json({ scan: await scanLocation(locationId) });
}
