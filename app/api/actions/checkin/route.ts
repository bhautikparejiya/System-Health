import { NextResponse } from "next/server";
import { bump, q, q1 } from "@/lib/db";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";

/**
 * "Health Check-in" custom workflow action. Execution URL: {APP_BASE_URL}/api/actions/checkin
 * HighLevel POSTs { data: {...fields}, extras: { locationId, contactId, workflowId }, meta }.
 * Optional action field "window_days" sets this workflow's inactivity threshold.
 */
export async function POST(req: Request) {
  if (env.actionSecret && req.headers.get("x-health-secret") !== env.actionSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    data?: Record<string, unknown>;
    extras?: { locationId?: string; workflowId?: string; contactId?: string };
  };
  const locationId = body.extras?.locationId;
  const workflowId = body.extras?.workflowId;
  // Always answer 200 so a monitoring step can never break the client's workflow.
  if (!locationId || !workflowId) return NextResponse.json({ ok: false, reason: "missing locationId/workflowId" });
  if (!(await q1(`select 1 from installations where location_id = $1`, [locationId]))) {
    return NextResponse.json({ ok: false, reason: "app not installed for this location" });
  }

  const days = Number(body.data?.window_days ?? body.data?.windowDays);
  const windowHours = Number.isFinite(days) && days > 0 ? Math.min(90, days) * 24 : null;
  const defaultHours = windowHours ?? (await getSettings(locationId)).workflowWindowHours;

  await q(
    `insert into monitored_workflows (location_id, workflow_id, window_hours, last_seen_at, total_count)
     values ($1, $2, $3, now(), 1)
     on conflict (location_id, workflow_id) do update set last_seen_at = now(),
       total_count = monitored_workflows.total_count + 1,
       window_hours = coalesce($4, monitored_workflows.window_hours)`,
    [locationId, workflowId, defaultHours, windowHours],
  );
  await bump(locationId, `wf:${workflowId}`);
  return NextResponse.json({ ok: true, recorded_at: new Date().toISOString() });
}
