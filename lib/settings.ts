import { q, q1 } from "./db";
import type { ModuleKey, Severity } from "./types";

export interface Settings {
  modules: Record<ModuleKey, boolean>;
  weights: Record<ModuleKey, number>;
  /** Default inactivity window for monitored workflows (hours) */
  workflowWindowHours: number;
  flagUnpublishedWorkflows: boolean;
  flagOffConversationAgents: boolean;
  voiceIdleDays: number;
  formIdleDays: number;
  calendarLookaheadDays: number;
  calendarIdleDays: number;
  inboxUnansweredHours: number;
  inboxCriticalCount: number;
  staleDealDays: number;
  msgFailWarnPct: number;
  msgFailCritPct: number;
  leadsIdleHours: number;
  /** Lowest severity that fires the "Health issue detected" trigger */
  alertMinSeverity: Severity;
}

export const DEFAULT_SETTINGS: Settings = {
  modules: {
    workflows: true,
    conversationAi: true,
    voiceAi: true,
    calendars: true,
    forms: true,
    inbox: true,
    pipelines: true,
    messaging: true,
    leads: true,
  },
  weights: {
    workflows: 30,
    conversationAi: 8,
    voiceAi: 7,
    calendars: 10,
    forms: 8,
    inbox: 10,
    pipelines: 5,
    messaging: 15,
    leads: 7,
  },
  workflowWindowHours: 72,
  flagUnpublishedWorkflows: true,
  flagOffConversationAgents: true,
  voiceIdleDays: 3,
  formIdleDays: 7,
  calendarLookaheadDays: 7,
  calendarIdleDays: 14,
  inboxUnansweredHours: 24,
  inboxCriticalCount: 10,
  staleDealDays: 14,
  msgFailWarnPct: 2,
  msgFailCritPct: 5,
  leadsIdleHours: 48,
  alertMinSeverity: "warning",
};

function merge(saved: Partial<Settings> | null | undefined): Settings {
  const s = saved ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    modules: { ...DEFAULT_SETTINGS.modules, ...(s.modules ?? {}) },
    weights: { ...DEFAULT_SETTINGS.weights, ...(s.weights ?? {}) },
  };
}

export async function getSettings(locationId: string): Promise<Settings> {
  const row = await q1<{ data: Partial<Settings> }>(`select data from location_settings where location_id = $1`, [locationId]);
  return merge(row?.data);
}

const NUMBER_LIMITS: Partial<Record<keyof Settings, [number, number]>> = {
  workflowWindowHours: [1, 24 * 90],
  voiceIdleDays: [1, 60],
  formIdleDays: [1, 90],
  calendarLookaheadDays: [1, 30],
  calendarIdleDays: [1, 90],
  inboxUnansweredHours: [1, 24 * 14],
  inboxCriticalCount: [1, 1000],
  staleDealDays: [1, 365],
  msgFailWarnPct: [0.1, 100],
  msgFailCritPct: [0.1, 100],
  leadsIdleHours: [6, 24 * 30],
};

/** Validates and stores a partial settings update. Unknown keys are ignored. */
export async function saveSettings(locationId: string, patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings(locationId);
  const next: Settings = merge(current);
  for (const [k, [min, max]] of Object.entries(NUMBER_LIMITS) as [keyof Settings, [number, number]][]) {
    const v = patch[k];
    if (typeof v === "number" && Number.isFinite(v)) (next as unknown as Record<string, number>)[k] = Math.min(max, Math.max(min, v));
  }
  for (const k of ["flagUnpublishedWorkflows", "flagOffConversationAgents"] as const) {
    if (typeof patch[k] === "boolean") next[k] = patch[k] as boolean;
  }
  if (patch.alertMinSeverity && ["critical", "warning", "info"].includes(patch.alertMinSeverity)) {
    next.alertMinSeverity = patch.alertMinSeverity;
  }
  for (const k of Object.keys(DEFAULT_SETTINGS.modules) as ModuleKey[]) {
    if (typeof patch.modules?.[k] === "boolean") next.modules[k] = patch.modules[k];
    const w = patch.weights?.[k];
    if (typeof w === "number" && w >= 0 && w <= 100) next.weights[k] = w;
  }
  await q(
    `insert into location_settings (location_id, data, updated_at) values ($1, $2::jsonb, now())
     on conflict (location_id) do update set data = excluded.data, updated_at = now()`,
    [locationId, JSON.stringify(next)],
  );
  return next;
}
