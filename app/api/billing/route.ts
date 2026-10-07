import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { counterSeries, q } from "@/lib/db";
import { GhlError, ghl } from "@/lib/ghl";
import { fetchHasFunds, fetchSubscriptions, fetchTransactions, statusOf, summarizeSubscriptions, summarizeTransactions } from "@/lib/payments";

export const maxDuration = 60;

function reason(e: unknown): string {
  if (e instanceof GhlError && (e.status === 401 || e.status === 403)) return "Permission missing. Reinstall the app to grant billing access.";
  if (e instanceof GhlError) return `HighLevel API error ${e.status}`;
  return (e as Error).message;
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

/** Billing tab: wallet status, message usage (from our own counters) and the sub-account's customer payments. Read live, not stored. */
export async function GET(req: Request) {
  const locationId = new URL(req.url).searchParams.get("locationId");
  const access = await authorize(req, locationId);
  if (!access || access.kind !== "session" || !locationId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const api = <T,>(path: string, r: Parameters<typeof ghl>[2]) => ghl<T>(locationId, path, r);

  const [wallet, txns, subs] = await Promise.allSettled([
    fetchHasFunds(api),
    fetchTransactions(api, locationId, 30),
    fetchSubscriptions(api, locationId),
  ]);

  // Usage counted from webhooks (HighLevel has no public API for wallet usage or cost).
  const metrics = ["sms_out", "sms_fail", "email_out", "email_fail", "contacts_new"] as const;
  const series = Object.fromEntries(await Promise.all(metrics.map(async (m) => [m, await counterSeries(locationId, m, 30)] as const)));
  const wfRows = await q<{ n: string }>(
    `select coalesce(sum(count), 0)::text as n from daily_counters where location_id = $1 and metric like 'wf:%' and day >= current_date - 29`,
    [locationId],
  );
  const inst = await q<{ installed_at: string }>(`select installed_at from installations where location_id = $1`, [locationId]);

  let payments = null;
  if (txns.status === "fulfilled") {
    const t = summarizeTransactions(txns.value);
    payments = {
      currency: t.currency,
      otherCurrencies: t.otherCurrencies,
      paidCount: t.paidCount,
      gross: t.gross,
      refunded: t.refunded,
      net: t.net,
      failedCount: t.failed.length,
      failedAmount: t.failedAmount,
      recentFailed: t.failed.slice(0, 10).map((x) => ({
        name: x.contactName ?? "Unknown",
        amount: x.amount ?? 0,
        source: x.entitySourceName ?? "",
        date: x.createdAt ?? null,
      })),
    };
  }
  let subscriptions = null;
  if (subs.status === "fulfilled") {
    const s = summarizeSubscriptions(subs.value);
    subscriptions = {
      active: s.active.length,
      trialing: s.trialing.length,
      pastDue: s.pastDue.length,
      canceled: s.canceled.length,
      total: s.total,
      activeAmount: s.active.reduce((a, x) => a + (x.amount ?? 0), 0),
      pastDueList: s.pastDue.slice(0, 10).map((x) => ({ name: x.contactName ?? "Unknown", amount: x.amount ?? 0, source: x.entitySourceName ?? "", status: statusOf(x.status) })),
    };
  }

  return NextResponse.json({
    wallet: wallet.status === "fulfilled" ? { hasFunds: wallet.value } : { hasFunds: null, error: reason(wallet.reason) },
    usage: {
      days: 30,
      trackingSince: inst[0]?.installed_at ?? null,
      sms: { sent: sum(series.sms_out), failed: sum(series.sms_fail), daily: series.sms_out },
      email: { sent: sum(series.email_out), failed: sum(series.email_fail), daily: series.email_out },
      newContacts: sum(series.contacts_new),
      checkinRuns: Number(wfRows[0]?.n ?? 0),
    },
    payments: payments ?? { error: txns.status === "rejected" ? reason(txns.reason) : null },
    subscriptions: subscriptions ?? { error: subs.status === "rejected" ? reason(subs.reason) : null },
  });
}
