// Messaging and new-lead checks, built from webhook events counted in daily_counters.
import { counterSeries } from "../db";
import type { Issue, ModuleResult } from "../types";
import { CheckContext, DAY, links, result } from "./common";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export async function checkMessaging(ctx: CheckContext): Promise<ModuleResult> {
  const { locationId: loc, settings, now } = ctx;
  // Today + yesterday (UTC) ≈ the last 24–48h.
  const [smsOut, smsFail, emailOut, emailFail] = await Promise.all(
    ["sms_out", "sms_fail", "email_out", "email_fail"].map(async (m) => sum(await counterSeries(loc, m, 2, now))),
  );
  const total = smsOut + emailOut;
  const failed = smsFail + emailFail;
  if (total < 20) {
    return result(
      "messaging",
      total ? `${total}` : "–",
      [{ label: total ? "low volume" : "collecting data", tone: "info" }],
      [],
      { status: "na" },
    );
  }
  const rate = (failed / total) * 100;
  const issues: Issue[] = [];
  if (rate >= settings.msgFailWarnPct) {
    const parts = [
      smsOut ? `SMS ${((smsFail / smsOut) * 100).toFixed(1)}% (${smsFail}/${smsOut})` : null,
      emailOut ? `Email ${((emailFail / emailOut) * 100).toFixed(1)}% (${emailFail}/${emailOut})` : null,
    ].filter(Boolean);
    issues.push({
      key: "msg-failrate",
      module: "messaging",
      severity: rate >= settings.msgFailCritPct ? "critical" : "warning",
      title: `Message failure rate ${rate.toFixed(1)}% in the last 24–48h`,
      detail: `${parts.join(" · ")} · Check A2P/10DLC registration, carrier filtering and email domain health`,
      link: links.inbox(loc),
    });
  }
  return result(
    "messaging",
    `${rate.toFixed(1)}%`,
    [{ label: "fail rate 48h", tone: issues.length ? (issues[0].severity === "critical" ? "bad" : "warn") : "ok" }],
    issues,
  );
}

export async function checkLeads(ctx: CheckContext): Promise<ModuleResult> {
  const { locationId: loc, settings, now } = ctx;
  const series = await counterSeries(loc, "contacts_new", 16, now); // 14 baseline days, yesterday, today
  const baseline = series.slice(0, 14);
  const installedDays = (now.getTime() - ctx.installedAt.getTime()) / DAY;
  const knownDays = Math.min(14, Math.floor(installedDays));
  const avg = knownDays > 0 ? sum(baseline.slice(14 - knownDays)) / knownDays : 0;
  const yesterday = series[14];
  const today = series[15];
  const idleDays = Math.max(1, Math.round(settings.leadsIdleHours / 24));
  const recent = sum(series.slice(16 - idleDays - 1)); // last `idleDays` full days + today

  if (installedDays < 2) {
    return result("leads", String(today), [{ label: "collecting data", tone: "info" }], [], { status: "na" });
  }
  const issues: Issue[] = [];
  if (avg >= 1 && recent === 0) {
    issues.push({
      key: "leads-none",
      module: "leads",
      severity: "critical",
      title: `No new contacts in ~${settings.leadsIdleHours} hours`,
      detail: `Normally ${avg.toFixed(1)} new contacts/day. Check ads, forms, funnels and integrations that create leads.`,
      link: links.contacts(loc),
    });
  } else if (avg >= 5 && yesterday < avg * 0.3) {
    issues.push({
      key: "leads-drop",
      module: "leads",
      severity: "warning",
      title: `New contacts dropped ${Math.round((1 - yesterday / avg) * 100)}% yesterday`,
      detail: `${yesterday} yesterday vs. ${avg.toFixed(1)}/day average`,
      link: links.contacts(loc),
    });
  }
  return result(
    "leads",
    String(yesterday),
    [
      { label: "yesterday", tone: "info" },
      { label: `avg ${avg.toFixed(1)}/day`, tone: issues.length ? "warn" : "ok" },
    ],
    issues,
  );
}
