import { test } from "node:test";
import assert from "node:assert/strict";
import { moduleScore, overallScore, scoreBand } from "../lib/score.ts";
import type { ModuleResult, Issue } from "../lib/types.ts";

const issue = (severity: Issue["severity"]): Issue => ({ key: Math.random().toString(), module: "workflows", severity, title: "x" });
const mod = (key: ModuleResult["key"], status: ModuleResult["status"], issues: Issue[]): ModuleResult => ({
  key, label: key, status, headline: "", chips: [], issues,
});
const weights = { workflows: 30, conversationAi: 8, voiceAi: 7, calendars: 10, forms: 8, inbox: 10, pipelines: 5, messaging: 15, leads: 7, wallet: 10, payments: 5 };

test("module score subtracts 25 per critical and 8 per warning, info is free", () => {
  assert.equal(moduleScore({ issues: [] }), 100);
  assert.equal(moduleScore({ issues: [issue("critical"), issue("warning"), issue("info")] }), 67);
  assert.equal(moduleScore({ issues: Array.from({ length: 5 }, () => issue("critical")) }), 0);
});

test("overall score is weighted and skips modules not in use or failed", () => {
  const modules = [
    mod("workflows", "bad", [issue("critical")]), // 75 * 30
    mod("calendars", "ok", []), // 100 * 10
    mod("voiceAi", "na", []), // skipped
    mod("forms", "error", []), // skipped
  ];
  assert.equal(overallScore(modules, weights), Math.min(79, Math.round((75 * 30 + 100 * 10) / 40)));
  assert.equal(overallScore([mod("voiceAi", "na", [])], weights), null);
});

test("critical issues cap the overall score so it never reads Healthy", () => {
  const healthyElsewhere = [mod("workflows", "ok", []), mod("leads", "ok", [])];
  const oneCritical = [...healthyElsewhere, mod("calendars", "bad", [issue("critical")])];
  const threeCritical = [...healthyElsewhere, mod("calendars", "bad", [issue("critical"), issue("critical"), issue("critical")])];
  assert.equal(overallScore(healthyElsewhere, weights), 100);
  assert.equal(overallScore(oneCritical, weights), 79);
  assert.equal(overallScore(threeCritical, weights), 69);
});

test("score bands", () => {
  assert.equal(scoreBand(95).label, "Healthy");
  assert.equal(scoreBand(80).label, "Needs attention");
  assert.equal(scoreBand(40).label, "At risk");
  assert.equal(scoreBand(null).tone, "info");
});
