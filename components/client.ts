"use client";

import type { ScanResult, WorkflowSummary } from "@/lib/types";
import type { Settings } from "@/lib/settings";

export interface Auth {
  token?: string;
  embedKey?: string;
}

export interface HealthResponse {
  locationName: string | null;
  scan: ScanResult | null;
  history: { day: string; score: number }[];
  readOnly: boolean;
}

export interface MonitoredRow {
  workflow_id: string;
  workflow_name: string | null;
  window_hours: number;
  enabled: boolean;
  first_seen_at: string;
  last_seen_at: string | null;
  total_count: number;
}

export interface SettingsResponse {
  settings: Settings;
  monitored: MonitoredRow[];
  workflows: WorkflowSummary[];
  embedUrl: string;
}

export async function api<T>(path: string, auth: Auth, init: RequestInit = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (auth.embedKey) url.searchParams.set("k", auth.embedKey);
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Origin of the HighLevel app around our iframe (agencies may use a white-label domain). */
export function ghlOrigin(): string {
  try {
    const anc = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
    if (anc && anc.length) return anc[anc.length - 1];
    if (document.referrer) {
      const o = new URL(document.referrer).origin;
      if (o !== window.location.origin) return o;
    }
  } catch {
    /* ignore */
  }
  return "https://app.gohighlevel.com";
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
