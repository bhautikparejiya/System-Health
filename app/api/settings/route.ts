import { NextResponse } from "next/server";
import { authorize, embedKey } from "@/lib/auth";
import { q } from "@/lib/db";
import { env } from "@/lib/env";
import { latestScan } from "@/lib/scan";
import { getSettings, saveSettings, type Settings } from "@/lib/settings";
import type { WorkflowSummary } from "@/lib/types";

async function payload(locationId: string) {
  const scan = await latestScan(locationId);
  const wfModule = scan?.modules.find((m) => m.key === "workflows") as { workflows?: WorkflowSummary[] } | undefined;
  const monitored = await q(
    `select workflow_id, workflow_name, window_hours, enabled, first_seen_at, last_seen_at, total_count
       from monitored_workflows where location_id = $1 order by workflow_name`,
    [locationId],
  );
  return {
    settings: await getSettings(locationId),
    monitored: monitored.map((m) => ({ ...m, total_count: Number(m.total_count) })),
    workflows: wfModule?.workflows ?? [],
    embedUrl: `${env.baseUrl}/embed?l=${encodeURIComponent(locationId)}&k=${embedKey(locationId)}`,
  };
}

export async function GET(req: Request) {
  const locationId = new URL(req.url).searchParams.get("locationId");
  const access = await authorize(req, locationId);
  if (!access || access.kind !== "session" || !locationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await payload(locationId));
}

interface MonitoredPatch {
  workflowId: string;
  name?: string;
  windowHours?: number;
  enabled?: boolean;
  remove?: boolean;
}

export async function PUT(req: Request) {
  const locationId = new URL(req.url).searchParams.get("locationId");
  const access = await authorize(req, locationId);
  if (!access || access.kind !== "session" || !locationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { settings?: Partial<Settings>; monitored?: MonitoredPatch[] };
  if (body.settings) await saveSettings(locationId, body.settings);
  for (const m of body.monitored ?? []) {
    if (!m.workflowId) continue;
    if (m.remove) {
      await q(`delete from monitored_workflows where location_id = $1 and workflow_id = $2`, [locationId, m.workflowId]);
      continue;
    }
    const hours = Math.min(24 * 90, Math.max(1, Math.round(m.windowHours ?? (await getSettings(locationId)).workflowWindowHours)));
    await q(
      `insert into monitored_workflows (location_id, workflow_id, workflow_name, window_hours, enabled)
       values ($1, $2, $3, $4, coalesce($5, true))
       on conflict (location_id, workflow_id) do update set window_hours = excluded.window_hours,
         enabled = coalesce($5, monitored_workflows.enabled),
         workflow_name = coalesce(excluded.workflow_name, monitored_workflows.workflow_name)`,
      [locationId, m.workflowId, m.name ?? null, hours, m.enabled ?? null],
    );
  }
  return NextResponse.json(await payload(locationId));
}
