import { NextResponse } from "next/server";
import { q, q1 } from "@/lib/db";

/**
 * Subscription URL of the "Health issue detected" custom trigger: {APP_BASE_URL}/api/triggers/subscribe
 * HighLevel calls it when a workflow using the trigger is created, updated or deleted.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    triggerData?: { id?: string; key?: string; filters?: unknown; eventType?: string; targetUrl?: string };
    extras?: { locationId?: string; workflowId?: string };
  };
  const t = body.triggerData;
  const locationId = body.extras?.locationId;
  if (!t?.id || !locationId) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  if (t.eventType === "DELETED") {
    await q(`delete from trigger_subscriptions where id = $1`, [t.id]);
    return NextResponse.json({ ok: true });
  }

  // We send the location's access token to targetUrl, so only ever accept HighLevel's own host.
  let host = "";
  try {
    host = new URL(t.targetUrl ?? "").hostname;
  } catch {
    /* invalid */
  }
  if (host !== "services.leadconnectorhq.com") return NextResponse.json({ error: "Invalid targetUrl" }, { status: 400 });
  if (!(await q1(`select 1 from installations where location_id = $1`, [locationId]))) {
    return NextResponse.json({ error: "Not installed" }, { status: 404 });
  }

  await q(
    `insert into trigger_subscriptions (id, location_id, workflow_id, trigger_key, target_url, filters)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (id) do update set target_url = excluded.target_url, filters = excluded.filters, workflow_id = excluded.workflow_id`,
    [t.id, locationId, body.extras?.workflowId ?? null, t.key ?? null, t.targetUrl, JSON.stringify(t.filters ?? [])],
  );
  return NextResponse.json({ ok: true });
}
