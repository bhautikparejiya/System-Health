import { counterSeries, q } from "../db";
import { V } from "../ghl";
import type { Chip, Issue, ModuleResult, WorkflowSummary } from "../types";
import { CheckContext, DAY, HOUR, fmtDate, fmtDuration, links, listNames, plural, result, toTime } from "./common";

interface Monitored {
  workflow_id: string;
  workflow_name: string | null;
  window_hours: number;
  first_seen_at: string;
  last_seen_at: string | null;
}

export async function checkWorkflows(ctx: CheckContext): Promise<ModuleResult & { workflows: WorkflowSummary[] }> {
  const { locationId: loc, settings, now } = ctx;
  const res = await ctx.api<{ workflows?: WorkflowSummary[] }>("/workflows/", {
    version: V.workflows,
    query: { locationId: loc },
  });
  const workflows = res.workflows ?? [];
  const byId = new Map(workflows.map((w) => [w.id, w]));
  const published = workflows.filter((w) => w.status === "published");
  const drafts = workflows.filter((w) => w.status !== "published");
  const issues: Issue[] = [];

  // --- Status change tracking: "was published, now draft" -------------------------------
  const prevRows = await q<{ workflow_id: string; status: string; last_published_at: string | null; status_changed_at: string | null }>(
    `select workflow_id, status, last_published_at, status_changed_at from workflow_status where location_id = $1`,
    [loc],
  );
  const prev = new Map(prevRows.map((r) => [r.workflow_id, r]));
  const unpublished: { w: WorkflowSummary; at: number }[] = [];
  for (const w of workflows) {
    const p = prev.get(w.id);
    const changed = p && p.status !== w.status;
    const lastPublished = w.status === "published" ? now : p?.last_published_at ?? null;
    const changedAt = changed ? now : p?.status_changed_at ?? null;
    if (!p || changed || w.status === "published") {
      await q(
        `insert into workflow_status (location_id, workflow_id, status, last_published_at, status_changed_at)
         values ($1, $2, $3, $4, $5)
         on conflict (location_id, workflow_id) do update set status = excluded.status,
           last_published_at = excluded.last_published_at, status_changed_at = excluded.status_changed_at`,
        [loc, w.id, w.status, lastPublished, changedAt],
      );
    }
    const changedTime = toTime(changedAt);
    if (w.status !== "published" && lastPublished && changedTime && now.getTime() - changedTime < 7 * DAY) {
      unpublished.push({ w, at: changedTime });
    }
  }
  if (settings.flagUnpublishedWorkflows) {
    for (const { w, at } of unpublished) {
      issues.push({
        key: `wf-unpublished:${w.id}`,
        module: "workflows",
        severity: "warning",
        title: `“${w.name}” was switched from Published to Draft`,
        detail: `Changed ${fmtDuration(now.getTime() - at)} ago · Contacts no longer enter this workflow`,
        link: links.workflow(loc, w.id),
      });
    }
  }

  // --- Inactivity monitoring (needs the "Health Check-in" action) ---------------------------
  const monitored = await q<Monitored>(
    `select workflow_id, workflow_name, window_hours, first_seen_at, last_seen_at
       from monitored_workflows where location_id = $1 and enabled = true`,
    [loc],
  );
  let idle = 0;
  for (const m of monitored) {
    const w = byId.get(m.workflow_id);
    const name = w?.name ?? m.workflow_name ?? m.workflow_id;
    if (w && w.name !== m.workflow_name) {
      await q(`update monitored_workflows set workflow_name = $3 where location_id = $1 and workflow_id = $2`, [loc, m.workflow_id, w.name]);
    }
    if (!w) {
      issues.push({
        key: `wf-missing:${m.workflow_id}`,
        module: "workflows",
        severity: "warning",
        title: `Monitored workflow “${name}” no longer exists`,
        detail: "It was deleted or moved. Remove it from monitoring in Settings.",
        link: links.workflows(loc),
      });
      continue;
    }
    if (w.status !== "published") continue; // drafts receive no contacts by design

    const windowMs = m.window_hours * HOUR;
    const ref = toTime(m.last_seen_at) ?? toTime(m.first_seen_at) ?? now.getTime();
    const gap = now.getTime() - ref;
    if (gap > windowMs) {
      idle++;
      issues.push({
        key: `wf-idle:${m.workflow_id}`,
        module: "workflows",
        severity: "critical",
        title: `“${name}” – no contacts entered in ${fmtDuration(gap)}`,
        detail: m.last_seen_at
          ? `Threshold: ${fmtDuration(windowMs)} · Last enrollment ${fmtDate(m.last_seen_at)}`
          : `Threshold: ${fmtDuration(windowMs)} · No check-in received yet. Is “Health Check-in” the first step of this workflow?`,
        link: links.workflow(loc, m.workflow_id),
      });
      continue;
    }

    // Volume drop: yesterday vs. the 14 days before it.
    const series = await counterSeries(loc, `wf:${m.workflow_id}`, 16, now); // [..14 baseline.., yesterday, today]
    const baseline = series.slice(0, 14);
    const daysWithData = baseline.filter((n) => n > 0).length;
    const avg = baseline.reduce((a, b) => a + b, 0) / 14;
    const yesterday = series[14];
    if (daysWithData >= 7 && avg >= 5 && yesterday < avg * 0.5) {
      issues.push({
        key: `wf-drop:${m.workflow_id}`,
        module: "workflows",
        severity: "warning",
        title: `“${name}” – enrollments dropped ${Math.round((1 - yesterday / avg) * 100)}% yesterday`,
        detail: `${yesterday} yesterday vs. ${avg.toFixed(1)}/day average over the previous 14 days`,
        link: links.workflow(loc, m.workflow_id),
      });
    }
  }

  // --- Informational ------------------------------------------------------------------------
  if (drafts.length) {
    issues.push({
      key: "wf-drafts",
      module: "workflows",
      severity: "info",
      title: `${plural(drafts.length, "workflow")} in Draft`,
      detail: listNames(drafts.map((d) => d.name)),
      link: links.workflows(loc),
    });
  }
  const edited = published.filter((w) => {
    const t = toTime(w.updatedAt);
    return t !== null && now.getTime() - t < DAY;
  });
  if (edited.length) {
    issues.push({
      key: "wf-edited",
      module: "workflows",
      severity: "info",
      title: `${plural(edited.length, "published workflow")} edited in the last 24h`,
      detail: listNames(edited.map((w) => w.name)),
      link: links.workflows(loc),
    });
  }
  if (!monitored.length) {
    issues.push({
      key: "wf-setup",
      module: "workflows",
      severity: "info",
      title: "Inactivity monitoring is not set up yet",
      detail: "Add the “Health Check-in” action as the first step of your key workflows, or pick workflows in Settings.",
      link: links.workflows(loc),
    });
  }

  const chips: Chip[] = [
    { label: `${published.length} live`, tone: "ok" },
    { label: `${drafts.length} draft`, tone: "info" },
  ];
  if (idle) chips.push({ label: `${idle} idle`, tone: "bad" });
  if (monitored.length) chips.push({ label: `${monitored.length} monitored`, tone: "info" });

  return {
    ...result("workflows", String(workflows.length), chips, issues),
    workflows: workflows.map(({ id, name, status, updatedAt }) => ({ id, name, status, updatedAt })),
  };
}
