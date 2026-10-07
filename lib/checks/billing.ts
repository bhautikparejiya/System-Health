import { fetchHasFunds, fetchSubscriptions, fetchTransactions, money, summarizeSubscriptions, summarizeTransactions } from "../payments";
import type { Issue, ModuleResult } from "../types";
import { CheckContext, links, plural, result } from "./common";

export async function checkWallet(ctx: CheckContext): Promise<ModuleResult> {
  const hasFunds = await fetchHasFunds(ctx.api);
  if (hasFunds === null) return result("wallet", "–", [{ label: "status unknown", tone: "info" }], [], { status: "na" });
  const issues: Issue[] = hasFunds
    ? []
    : [
        {
          key: "wallet-empty",
          module: "wallet",
          severity: "critical",
          title: "Wallet balance is too low",
          detail: "SMS, calls, emails, AI and premium workflow actions charged to the wallet can stop. Add funds or turn on auto-recharge.",
          link: links.wallet(ctx.locationId),
        },
      ];
  return result("wallet", hasFunds ? "OK" : "Low", [hasFunds ? { label: "funds available", tone: "ok" } : { label: "top up needed", tone: "bad" }], issues);
}

export async function checkPayments(ctx: CheckContext): Promise<ModuleResult> {
  const loc = ctx.locationId;
  const [txns, subs] = await Promise.all([fetchTransactions(ctx.api, loc, 7, ctx.now), fetchSubscriptions(ctx.api, loc)]);
  if (!txns.length && !subs.length) return result("payments", "–", [{ label: "no payments", tone: "info" }], [], { status: "na" });

  const t = summarizeTransactions(txns);
  const s = summarizeSubscriptions(subs);
  const issues: Issue[] = [];
  if (t.failed.length >= ctx.settings.failedPaymentsWarn) {
    issues.push({
      key: "pay-failed",
      module: "payments",
      severity: "warning",
      title: `${plural(t.failed.length, "failed payment")} in the last 7 days (${money(t.failedAmount, t.currency)})`,
      detail: "Customers' cards were declined or payments errored. See the Billing tab for the list.",
      link: links.payments(loc),
    });
  }
  if (s.pastDue.length) {
    issues.push({
      key: "pay-pastdue",
      module: "payments",
      severity: "warning",
      title: `${plural(s.pastDue.length, "subscription")} past due`,
      detail: `${money(s.pastDue.reduce((a, x) => a + (x.amount ?? 0), 0), t.currency)} at risk · Follow up before they cancel`,
      link: links.subscriptions(loc),
    });
  }
  return result(
    "payments",
    money(t.net, t.currency),
    [
      { label: "net 7d", tone: "info" },
      ...(t.failed.length ? [{ label: `${t.failed.length} failed`, tone: "warn" as const }] : []),
      ...(s.pastDue.length ? [{ label: `${s.pastDue.length} past due`, tone: "warn" as const }] : []),
    ],
    issues,
  );
}
