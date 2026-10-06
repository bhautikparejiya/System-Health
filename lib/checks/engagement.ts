// Calendars, forms, inbox and pipelines: checks read directly from the HighLevel API.
import { counterSeries } from "../db";
import { V } from "../ghl";
import type { Issue, ModuleResult } from "../types";
import { CheckContext, DAY, HOUR, fmtDuration, links, listNames, mapLimit, plural, result, toTime } from "./common";

interface Calendar {
  id: string;
  name: string;
  isActive?: boolean;
}

export async function checkCalendars(ctx: CheckContext): Promise<ModuleResult> {
  const { locationId: loc, settings, now } = ctx;
  const res = await ctx.api<{ calendars?: Calendar[] }>("/calendars/", { version: V.calendars, query: { locationId: loc } });
  const calendars = res.calendars ?? [];
  if (!calendars.length) return result("calendars", "0", [{ label: "No calendars", tone: "info" }], [], { status: "na" });

  const active = calendars.filter((c) => c.isActive !== false).slice(0, 25);
  const inactive = calendars.filter((c) => c.isActive === false);
  const issues: Issue[] = [];
  let noSlots = 0;
  const installedDays = (now.getTime() - ctx.installedAt.getTime()) / DAY;

  await mapLimit(active, 3, async (c) => {
    const slots = await ctx.api<Record<string, unknown>>(`/calendars/${c.id}/free-slots`, {
      version: V.calendars,
      query: { startDate: now.getTime(), endDate: now.getTime() + settings.calendarLookaheadDays * DAY },
    });
    const count = Object.values(slots).reduce<number>((n, day) => {
      const s = (day as { slots?: unknown[] } | null)?.slots;
      return n + (Array.isArray(s) ? s.length : 0);
    }, 0);
    if (count === 0) {
      noSlots++;
      issues.push({
        key: `cal-noslots:${c.id}`,
        module: "calendars",
        severity: "critical",
        title: `“${c.name}” has 0 open slots in the next ${plural(settings.calendarLookaheadDays, "day")}`,
        detail: "Booking widgets and AI agents using this calendar can't book anyone. Check availability and team members.",
        link: links.calendars(loc),
      });
      return;
    }
    if (installedDays >= settings.calendarIdleDays) {
      const booked = (await counterSeries(loc, `appt:${c.id}`, settings.calendarIdleDays, now)).reduce((a, b) => a + b, 0);
      if (booked === 0) {
        issues.push({
          key: `cal-nobook:${c.id}`,
          module: "calendars",
          severity: "warning",
          title: `“${c.name}” – no new bookings in ${plural(settings.calendarIdleDays, "day")}`,
          detail: "Slots are open but nobody booked. Check the booking page, funnel links and related workflows.",
          link: links.calendars(loc),
        });
      }
    }
  });
  if (inactive.length) {
    issues.push({
      key: "cal-inactive",
      module: "calendars",
      severity: "info",
      title: `${plural(inactive.length, "calendar")} switched off`,
      detail: listNames(inactive.map((c) => c.name)),
      link: links.calendars(loc),
    });
  }
  return result(
    "calendars",
    String(calendars.length),
    [
      { label: `${active.length - noSlots} bookable`, tone: "ok" },
      ...(noSlots ? [{ label: `${noSlots} no slots`, tone: "bad" as const }] : []),
    ],
    issues,
  );
}

interface Form {
  id: string;
  name: string;
}

export async function checkForms(ctx: CheckContext): Promise<ModuleResult> {
  const { locationId: loc, settings, now } = ctx;
  const res = await ctx.api<{ forms?: Form[] }>("/forms/", { version: V.forms, query: { locationId: loc, limit: 50 } });
  const forms = (res.forms ?? []).slice(0, 40);
  if (!forms.length) return result("forms", "0", [{ label: "No forms", tone: "info" }], [], { status: "na" });

  const issues: Issue[] = [];
  let active = 0;
  let unused = 0;
  await mapLimit(forms, 3, async (f) => {
    const s = await ctx.api<{ submissions?: { createdAt?: string }[]; meta?: { total?: number } }>("/forms/submissions", {
      version: V.forms,
      query: { locationId: loc, formId: f.id, limit: 1, page: 1 },
    });
    const last = toTime(s.submissions?.[0]?.createdAt);
    if (!last) {
      unused++; // never submitted: probably not in use, so not flagged
      return;
    }
    const gap = now.getTime() - last;
    if (gap > settings.formIdleDays * DAY) {
      issues.push({
        key: `form-idle:${f.id}`,
        module: "forms",
        severity: "warning",
        title: `“${f.name}” – no submissions in ${fmtDuration(gap)}`,
        detail: `It used to receive submissions (${s.meta?.total ?? "?"} total). Check the page it's embedded on.`,
        link: links.forms(loc),
      });
    } else active++;
  });
  const quiet = issues.length;
  return result(
    "forms",
    String(forms.length),
    [
      { label: `${active} active`, tone: "ok" },
      ...(quiet ? [{ label: `${quiet} quiet`, tone: "warn" as const }] : []),
      ...(unused ? [{ label: `${unused} unused`, tone: "info" as const }] : []),
    ],
    issues,
  );
}

interface Conversation {
  id: string;
  lastMessageDate?: number | string;
  dateUpdated?: number | string;
}

export async function checkInbox(ctx: CheckContext): Promise<ModuleResult> {
  const { locationId: loc, settings, now } = ctx;
  const res = await ctx.api<{ conversations?: Conversation[] }>("/conversations/search", {
    version: V.conversations,
    query: {
      locationId: loc,
      lastMessageDirection: "inbound",
      status: "unread",
      sortBy: "last_message_date",
      sort: "desc",
      limit: 100,
    },
  });
  const threshold = settings.inboxUnansweredHours * HOUR;
  const waiting = (res.conversations ?? [])
    .map((c) => toTime(c.lastMessageDate ?? c.dateUpdated))
    .filter((t): t is number => t !== null)
    .map((t) => now.getTime() - t)
    .filter((age) => age > threshold && age < 14 * DAY);

  const issues: Issue[] = [];
  if (waiting.length) {
    const oldest = Math.max(...waiting);
    issues.push({
      key: "inbox-unanswered",
      module: "inbox",
      severity: waiting.length >= settings.inboxCriticalCount ? "critical" : "warning",
      title: `${plural(waiting.length, "conversation")} unanswered for more than ${fmtDuration(threshold)}`,
      detail: `Oldest waiting ${fmtDuration(oldest)} · Leads that wait this long often go cold`,
      link: links.inbox(loc),
    });
  }
  return result(
    "inbox",
    String(waiting.length),
    [waiting.length ? { label: `waiting >${settings.inboxUnansweredHours}h`, tone: "warn" } : { label: "all answered", tone: "ok" }],
    issues,
  );
}

interface Opportunity {
  id: string;
  pipelineId?: string;
  lastStageChangeAt?: string;
  lastStatusChangeAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

interface Pipeline {
  id: string;
  name: string;
}

export async function checkPipelines(ctx: CheckContext): Promise<ModuleResult> {
  const { locationId: loc, settings, now } = ctx;
  const { pipelines = [] } = await ctx.api<{ pipelines?: Pipeline[] }>("/opportunities/pipelines", {
    version: V.opportunities,
    query: { locationId: loc },
  });
  if (!pipelines.length) return result("pipelines", "0", [{ label: "No pipelines", tone: "info" }], [], { status: "na" });

  const open: Opportunity[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await ctx.api<{ opportunities?: Opportunity[] }>("/opportunities/search", {
      version: V.opportunities,
      query: { location_id: loc, status: "open", limit: 100, page },
    });
    const batch = res.opportunities ?? [];
    open.push(...batch);
    if (batch.length < 100) break;
  }

  const staleMs = settings.staleDealDays * DAY;
  const stale = open.filter((o) => {
    const t = toTime(o.lastStageChangeAt) ?? toTime(o.lastStatusChangeAt) ?? toTime(o.createdAt);
    return t !== null && now.getTime() - t > staleMs;
  });
  const issues: Issue[] = [];
  if (stale.length) {
    const names = new Map(pipelines.map((p) => [p.id, p.name]));
    const byPipeline = new Map<string, number>();
    for (const o of stale) {
      const name = names.get(o.pipelineId ?? "") ?? "Other";
      byPipeline.set(name, (byPipeline.get(name) ?? 0) + 1);
    }
    const breakdown = [...byPipeline.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}: ${c}`).join(" · ");
    issues.push({
      key: "pipe-stale",
      module: "pipelines",
      severity: "warning",
      title: `${stale.length} open ${stale.length === 1 ? "opportunity" : "opportunities"} with no stage change in ${settings.staleDealDays}+ days`,
      detail: `${breakdown} · ${Math.round((stale.length / open.length) * 100)}% of open deals${open.length >= 500 ? " (first 500 checked)" : ""}`,
      link: links.pipelines(loc),
    });
  }
  return result(
    "pipelines",
    String(pipelines.length),
    [
      { label: `${open.length} open ${open.length === 1 ? "deal" : "deals"}`, tone: open.length ? "info" : "ok" },
      ...(stale.length ? [{ label: `${stale.length} stale`, tone: "warn" as const }] : []),
    ],
    issues,
  );
}
