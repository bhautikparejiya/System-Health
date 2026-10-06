import { NextResponse } from "next/server";
import { bump, q, q1 } from "@/lib/db";
import { env } from "@/lib/env";
import { verifyGhlWebhook } from "@/lib/webhook-verify";

/** Removes everything we store for a location (required for Marketplace review: clean uninstall). */
async function purgeLocation(locationId: string) {
  for (const table of [
    "installations",
    "location_settings",
    "monitored_workflows",
    "daily_counters",
    "workflow_status",
    "scans",
    "score_history",
    "trigger_subscriptions",
    "alert_log",
  ]) {
    await q(`delete from ${table} where location_id = $1`, [locationId]);
  }
}

/**
 * Default webhook URL of the Marketplace app:  {APP_BASE_URL}/api/webhooks/ghl
 * Subscribed events: INSTALL, UNINSTALL, ContactCreate, OutboundMessage, LCEmailStats, AppointmentCreate
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!env.mock && !verifyGhlWebhook(raw, req.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let evt: any;
  try {
    evt = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Replay protection: reject old or duplicate deliveries.
  if (evt.timestamp && Math.abs(Date.now() - new Date(evt.timestamp).getTime()) > 10 * 60_000) {
    return NextResponse.json({ error: "Stale webhook" }, { status: 400 });
  }
  if (evt.webhookId) {
    const fresh = await q(`insert into processed_webhooks (webhook_id) values ($1) on conflict do nothing returning webhook_id`, [evt.webhookId]);
    if (!fresh.length) return NextResponse.json({ ok: true, duplicate: true });
  }

  const locationId: string | undefined = evt.locationId;
  switch (evt.type) {
    case "INSTALL":
      if (locationId) {
        await q(
          `insert into installations (location_id, company_id, plan_id) values ($1, $2, $3)
           on conflict (location_id) do update set company_id = coalesce(excluded.company_id, installations.company_id),
             plan_id = coalesce(excluded.plan_id, installations.plan_id)`,
          [locationId, evt.companyId ?? null, evt.planId ?? null],
        );
      }
      break;

    case "UNINSTALL":
      if (locationId) await purgeLocation(locationId);
      else if (evt.companyId) {
        const locs = await q<{ location_id: string }>(`select location_id from installations where company_id = $1`, [evt.companyId]);
        for (const l of locs) await purgeLocation(l.location_id);
        await q(`delete from companies where company_id = $1`, [evt.companyId]);
      }
      break;

    default: {
      if (!locationId || !(await q1(`select 1 from installations where location_id = $1`, [locationId]))) break;
      if (evt.type === "ContactCreate") await bump(locationId, "contacts_new");
      else if (evt.type === "OutboundMessage" && evt.messageType === "SMS") {
        await bump(locationId, "sms_out");
        if (["failed", "undelivered"].includes(String(evt.status).toLowerCase())) await bump(locationId, "sms_fail");
      } else if (evt.type === "LCEmailStats") {
        const e = evt.webhookPayload ?? {};
        if (e.event === "delivered") await bump(locationId, "email_out");
        else if (e.event === "failed" && e.severity !== "temporary") {
          await bump(locationId, "email_out");
          await bump(locationId, "email_fail");
        }
      } else if (evt.type === "AppointmentCreate" && evt.appointment?.calendarId) {
        await bump(locationId, `appt:${evt.appointment.calendarId}`);
      }
    }
  }
  return NextResponse.json({ ok: true });
}
