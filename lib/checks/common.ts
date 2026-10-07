import type { Settings } from "../settings";
import type { Chip, Issue, ModuleKey, ModuleResult, ModuleStatus } from "../types";
import type { GhlRequest } from "../ghl";

export interface CheckContext {
  locationId: string;
  settings: Settings;
  installedAt: Date;
  now: Date;
  api: <T>(path: string, req: GhlRequest) => Promise<T>;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

export const LABELS: Record<ModuleKey, string> = {
  workflows: "Workflows",
  conversationAi: "Conversation AI",
  voiceAi: "Voice AI",
  calendars: "Calendars",
  forms: "Forms",
  inbox: "Inbox",
  pipelines: "Pipelines",
  messaging: "Messaging",
  leads: "New Leads",
  wallet: "Wallet",
  payments: "Payments",
};

/** Paths inside the HighLevel web app (prefixed with the agency's own domain in the browser). */
export const links = {
  workflows: (l: string) => `/v2/location/${l}/automation/workflows`,
  workflow: (l: string, id: string) => `/v2/location/${l}/automation/workflows/${id}`,
  conversationAi: (l: string) => `/v2/location/${l}/ai-agents/conversation-ai`,
  voiceAi: (l: string) => `/v2/location/${l}/ai-agents/voice-ai`,
  calendars: (l: string) => `/v2/location/${l}/settings/calendars`,
  forms: (l: string) => `/v2/location/${l}/form-builder/main`,
  inbox: (l: string) => `/v2/location/${l}/conversations/conversations`,
  pipelines: (l: string) => `/v2/location/${l}/opportunities/list`,
  contacts: (l: string) => `/v2/location/${l}/contacts/smart_list/All`,
  wallet: (l: string) => `/v2/location/${l}/settings/company-billing`,
  payments: (l: string) => `/v2/location/${l}/payments/transactions`,
  subscriptions: (l: string) => `/v2/location/${l}/payments/subscriptions`,
};

/** Builds a module result and derives status from its issues. */
export function result(
  key: ModuleKey,
  headline: string,
  chips: Chip[],
  issues: Issue[],
  opts: { status?: ModuleStatus } = {},
): ModuleResult {
  const status: ModuleStatus =
    opts.status ??
    (issues.some((i) => i.severity === "critical") ? "bad" : issues.some((i) => i.severity === "warning") ? "warn" : "ok");
  return { key, label: LABELS[key], status, headline, chips, issues };
}

/** Run `fn` over items with at most `limit` in flight (keeps us under HighLevel's burst rate limit). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function fmtDuration(ms: number): string {
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (ms < 2 * DAY) return `${Math.round(ms / HOUR)} hours`;
  return `${Math.round(ms / DAY)} days`;
}

export function fmtDate(d: Date | string | number): string {
  return new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function toTime(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v : new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function listNames(names: string[], max = 4): string {
  const shown = names.slice(0, max).map((n) => `“${n}”`);
  return names.length > max ? `${shown.join(", ")} +${names.length - max} more` : shown.join(", ");
}
