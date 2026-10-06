import { q, q1 } from "./db";
import { GhlError, V, ghl } from "./ghl";
import { getSettings } from "./settings";
import { moduleScore, overallScore } from "./score";
import { sendAlerts } from "./alerts";
import type { Issue, ModuleKey, ModuleResult, ScanResult } from "./types";
import { CheckContext, LABELS } from "./checks/common";
import { checkWorkflows } from "./checks/workflows";
import { checkConversationAi, checkVoiceAi } from "./checks/ai";
import { checkCalendars, checkForms, checkInbox, checkPipelines } from "./checks/engagement";
import { checkLeads, checkMessaging } from "./checks/activity";

const CHECKS: Record<ModuleKey, (ctx: CheckContext) => Promise<ModuleResult>> = {
  workflows: checkWorkflows,
  conversationAi: checkConversationAi,
  voiceAi: checkVoiceAi,
  calendars: checkCalendars,
  forms: checkForms,
  inbox: checkInbox,
  pipelines: checkPipelines,
  messaging: checkMessaging,
  leads: checkLeads,
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 } as const;

function describeError(e: unknown): string {
  if (e instanceof GhlError) {
    if (e.status === 401 || e.status === 403) return "Permission missing. Reinstall the app to grant the latest scopes.";
    if (e.status === 404) return "Not available for this account.";
    if (e.status === 429) return "HighLevel rate limit reached; will retry on the next scan.";
    return `HighLevel API error ${e.status}.`;
  }
  return e instanceof Error ? e.message : "Unknown error";
}

/** Runs every enabled check for one location, stores the result and fires alerts for new issues. */
export async function scanLocation(locationId: string): Promise<ScanResult> {
  try {
    return await runScan(locationId);
  } finally {
    await q(`update installations set scan_lock_until = null where location_id = $1`, [locationId]);
  }
}

async function runScan(locationId: string): Promise<ScanResult> {
  const started = Date.now();
  const inst = await q1(`select installed_at, location_name from installations where location_id = $1`, [locationId]);
  if (!inst) throw new Error(`Location ${locationId} is not installed`);
  const settings = await getSettings(locationId);
  const ctx: CheckContext = {
    locationId,
    settings,
    installedAt: new Date(inst.installed_at),
    now: new Date(),
    api: (path, req) => ghl(locationId, path, req),
  };

  if (!inst.location_name) {
    try {
      const l = await ctx.api<{ location?: { name?: string } }>(`/locations/${locationId}`, { version: V.locations });
      if (l.location?.name) await q(`update installations set location_name = $2 where location_id = $1`, [locationId, l.location.name]);
    } catch {
      /* name is cosmetic */
    }
  }

  const keys = (Object.keys(CHECKS) as ModuleKey[]).filter((k) => settings.modules[k]);
  // Two module checks at a time; each check limits its own parallel calls.
  const modules: ModuleResult[] = [];
  for (let i = 0; i < keys.length; i += 2) {
    const batch = keys.slice(i, i + 2);
    const settled = await Promise.allSettled(batch.map((k) => CHECKS[k](ctx)));
    settled.forEach((s, j) => {
      const key = batch[j];
      if (s.status === "fulfilled") modules.push({ ...s.value, score: moduleScore(s.value) });
      else {
        console.error(`[scan] ${locationId} ${key} failed:`, s.reason);
        modules.push({ key, label: LABELS[key], status: "error", headline: "–", chips: [{ label: "check failed", tone: "info" }], issues: [], error: describeError(s.reason) });
      }
    });
  }
  modules.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));

  const issues: Issue[] = modules
    .flatMap((m) => m.issues)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const score = overallScore(modules, settings.weights);
  const scan: ScanResult = {
    locationId,
    scannedAt: new Date().toISOString(),
    score,
    modules,
    issues,
    durationMs: Date.now() - started,
  };

  await q(
    `insert into scans (location_id, scanned_at, score, result) values ($1, $2, $3, $4::jsonb)
     on conflict (location_id) do update set scanned_at = excluded.scanned_at, score = excluded.score, result = excluded.result`,
    [locationId, scan.scannedAt, score, JSON.stringify(scan)],
  );
  if (score !== null) {
    await q(
      `insert into score_history (location_id, day, score) values ($1, $2::date, $3)
       on conflict (location_id, day) do update set score = excluded.score`,
      [locationId, scan.scannedAt.slice(0, 10), score],
    );
  }
  await q(`update installations set last_scanned_at = now() where location_id = $1`, [locationId]);

  try {
    await sendAlerts(locationId, scan, settings);
  } catch (e) {
    console.error(`[alerts] ${locationId}`, e);
  }
  return scan;
}

/** Takes a short lock so the cron job and a manual "Scan now" don't run the same location twice. */
export async function tryLockLocation(locationId: string, seconds = 300): Promise<boolean> {
  const rows = await q(
    `update installations set scan_lock_until = now() + make_interval(secs => $2)
      where location_id = $1 and (scan_lock_until is null or scan_lock_until < now())
      returning location_id`,
    [locationId, seconds],
  );
  return rows.length > 0;
}

export async function latestScan(locationId: string): Promise<ScanResult | null> {
  const row = await q1<{ result: ScanResult | string }>(`select result from scans where location_id = $1`, [locationId]);
  if (!row) return null;
  return typeof row.result === "string" ? (JSON.parse(row.result) as ScanResult) : row.result;
}
