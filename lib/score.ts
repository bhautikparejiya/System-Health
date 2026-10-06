import type { ModuleKey, ModuleResult } from "./types";

export const CRITICAL_PENALTY = 25;
export const WARNING_PENALTY = 8;

/** 100 minus penalties per issue, floored at 0. */
export function moduleScore(m: Pick<ModuleResult, "issues">): number {
  let s = 100;
  for (const i of m.issues) {
    if (i.severity === "critical") s -= CRITICAL_PENALTY;
    else if (i.severity === "warning") s -= WARNING_PENALTY;
  }
  return Math.max(0, s);
}

/**
 * Weighted average of module scores. Modules not in use ("na") or that failed ("error") are left out.
 * Critical issues cap the result, so an account with something broken never reads as "Healthy":
 * 1–2 critical → at most 79 (Needs attention), 3+ critical → at most 69 (At risk).
 */
export function overallScore(modules: ModuleResult[], weights: Record<ModuleKey, number>): number | null {
  let total = 0;
  let weightSum = 0;
  let critical = 0;
  for (const m of modules) {
    if (m.status === "na" || m.status === "error") continue;
    critical += m.issues.filter((i) => i.severity === "critical").length;
    const w = weights[m.key] ?? 0;
    if (w <= 0) continue;
    total += (m.score ?? moduleScore(m)) * w;
    weightSum += w;
  }
  if (!weightSum) return null;
  const score = Math.round(total / weightSum);
  return Math.min(score, critical >= 3 ? 69 : critical >= 1 ? 79 : 100);
}

export function scoreBand(score: number | null): { label: string; tone: "ok" | "warn" | "bad" | "info" } {
  if (score === null) return { label: "Not enough data", tone: "info" };
  if (score >= 90) return { label: "Healthy", tone: "ok" };
  if (score >= 70) return { label: "Needs attention", tone: "warn" };
  return { label: "At risk", tone: "bad" };
}
