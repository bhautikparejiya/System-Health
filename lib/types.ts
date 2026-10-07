export type ModuleKey =
  | "workflows"
  | "conversationAi"
  | "voiceAi"
  | "calendars"
  | "forms"
  | "inbox"
  | "pipelines"
  | "messaging"
  | "leads"
  | "wallet"
  | "payments";

export type Severity = "critical" | "warning" | "info";
export type Tone = "ok" | "warn" | "bad" | "info";

/** ok/warn/bad from issues; "na" = feature not in use or still collecting data; "error" = check could not run. */
export type ModuleStatus = "ok" | "warn" | "bad" | "na" | "error";

export interface Issue {
  /** Stable id, used for alert de-duplication, e.g. "wf-idle:abc123" */
  key: string;
  module: ModuleKey;
  severity: Severity;
  title: string;
  detail?: string;
  /** Path inside the HighLevel app, e.g. /v2/location/{id}/automation/workflows */
  link?: string;
}

export interface Chip {
  label: string;
  tone: Tone;
}

export interface ModuleResult {
  key: ModuleKey;
  label: string;
  status: ModuleStatus;
  /** Big number on the card */
  headline: string;
  chips: Chip[];
  issues: Issue[];
  score?: number;
  error?: string;
}

export interface ScanResult {
  locationId: string;
  scannedAt: string;
  score: number | null;
  modules: ModuleResult[];
  issues: Issue[];
  durationMs: number;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  status: string;
  updatedAt?: string;
}
