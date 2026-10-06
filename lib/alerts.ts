import { q } from "./db";
import { fireTrigger } from "./ghl";
import type { Settings } from "./settings";
import type { ScanResult } from "./types";

const RANK = { critical: 3, warning: 2, info: 1 } as const;

/**
 * Fires the "Health issue detected" custom trigger once per newly opened issue.
 * Issues that disappear are closed, so they alert again if they come back later.
 */
export async function sendAlerts(locationId: string, scan: ScanResult, settings: Settings): Promise<void> {
  const min = RANK[settings.alertMinSeverity];
  const active = scan.issues.filter((i) => RANK[i.severity] >= min);
  const open = await q<{ issue_key: string }>(`select issue_key from alert_log where location_id = $1`, [locationId]);
  const openKeys = new Set(open.map((r) => r.issue_key));
  const activeKeys = new Set(active.map((i) => i.key));

  const resolved = [...openKeys].filter((k) => !activeKeys.has(k));
  if (resolved.length) {
    await q(`delete from alert_log where location_id = $1 and issue_key = any($2::text[])`, [locationId, resolved]);
  }

  const fresh = active.filter((i) => !openKeys.has(i.key));
  if (!fresh.length) return;

  const subs = await q<{ id: string; target_url: string }>(`select id, target_url from trigger_subscriptions where location_id = $1`, [locationId]);
  for (const issue of fresh) {
    const payload = {
      issue_key: issue.key,
      severity: issue.severity,
      module: issue.module,
      title: issue.title,
      detail: issue.detail ?? "",
      health_score: scan.score ?? "",
      location_id: locationId,
      detected_at: scan.scannedAt,
    };
    for (const s of subs) {
      try {
        await fireTrigger(locationId, s.target_url, payload);
      } catch (e) {
        console.error(`[alerts] trigger ${s.id} failed`, e);
      }
    }
    await q(
      `insert into alert_log (location_id, issue_key, last_alerted_at) values ($1, $2, now())
       on conflict (location_id, issue_key) do update set last_alerted_at = now()`,
      [locationId, issue.key],
    );
  }
}
