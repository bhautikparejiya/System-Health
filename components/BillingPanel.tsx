"use client";

import { useEffect, useState } from "react";
import { api, ghlOrigin, timeAgo, type Auth } from "./client";

interface Person {
  name: string;
  amount: number;
  source: string;
  date?: string | null;
  status?: string;
}

interface BillingResponse {
  wallet: { hasFunds: boolean | null; error?: string };
  usage: {
    days: number;
    trackingSince: string | null;
    sms: { sent: number; failed: number; daily: number[] };
    email: { sent: number; failed: number; daily: number[] };
    newContacts: number;
    checkinRuns: number;
  };
  payments:
    | { error: string | null }
    | {
        currency: string;
        otherCurrencies: boolean;
        paidCount: number;
        gross: number;
        refunded: number;
        net: number;
        failedCount: number;
        failedAmount: number;
        recentFailed: Person[];
      };
  subscriptions:
    | { error: string | null }
    | { active: number; trialing: number; pastDue: number; canceled: number; total: number; activeAmount: number; pastDueList: Person[] };
}

function fmt(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

function Bars({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values);
  const w = 300, h = 48, bw = w / values.length;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      {values.map((v, i) => (
        <rect key={i} x={i * bw + 1} y={h - (v / max) * (h - 2)} width={Math.max(1, bw - 2)} height={(v / max) * (h - 2)} rx="1" fill="var(--accent)" opacity={i === values.length - 1 ? 0.5 : 1}>
          <title>{v}</title>
        </rect>
      ))}
    </svg>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div style={{ minWidth: 120 }}>
      <div className="small muted">{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone ? `var(--${tone})` : undefined }}>{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </div>
  );
}

const hasError = (x: object): x is { error: string | null } => "error" in x;

export function BillingPanel({ locationId, auth }: { locationId: string; auth: Auth }) {
  const [data, setData] = useState<BillingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<BillingResponse>(`/api/billing?locationId=${encodeURIComponent(locationId)}`, auth).then(setData).catch((e) => setError((e as Error).message));
  }, [locationId, auth]);

  if (error) return <div className="banner t-bad">{error}</div>;
  if (!data) return <div className="muted">Loading billing…</div>;

  const origin = ghlOrigin();
  const { wallet, usage, payments, subscriptions } = data;
  const smsRate = usage.sms.sent ? (usage.sms.failed / usage.sms.sent) * 100 : 0;
  const emailRate = usage.email.sent ? (usage.email.failed / usage.email.sent) * 100 : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="grid2">
        <div className="card">
          <div className="row spread"><h3>Wallet</h3><a className="small" href={`${origin}/v2/location/${locationId}/settings/company-billing`} target="_top">Open billing →</a></div>
          {wallet.hasFunds === null ? (
            <p className="muted">{wallet.error ?? "Wallet status unavailable."}</p>
          ) : wallet.hasFunds ? (
            <p><span className="pill t-ok">Funds available</span></p>
          ) : (
            <>
              <p><span className="pill t-bad">Balance too low</span></p>
              <p className="small">SMS, calls, emails, AI and premium actions charged to the wallet can stop. Add funds or turn on auto-recharge.</p>
            </>
          )}
          <p className="small muted">HighLevel shares whether the wallet has funds, but not the exact balance or per-message costs. Check exact amounts in Settings → Billing.</p>
        </div>

        <div className="card">
          <h3>Usage · last {usage.days} days</h3>
          <div className="row" style={{ gap: 24, margin: "8px 0" }}>
            <Stat label="SMS sent" value={usage.sms.sent.toLocaleString()} sub={`${usage.sms.failed} failed (${smsRate.toFixed(1)}%)`} tone={smsRate >= 5 ? "bad" : smsRate >= 2 ? "warn" : undefined} />
            <Stat label="Emails delivered" value={usage.email.sent.toLocaleString()} sub={`${usage.email.failed} failed (${emailRate.toFixed(1)}%)`} tone={emailRate >= 5 ? "bad" : emailRate >= 2 ? "warn" : undefined} />
            <Stat label="New contacts" value={usage.newContacts.toLocaleString()} />
            <Stat label="Check-in action runs" value={usage.checkinRuns.toLocaleString()} sub="premium action executions" />
          </div>
          <div className="small muted">SMS per day</div>
          <Bars values={usage.sms.daily} label="SMS sent per day, last 30 days" />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Counted by this app since it was installed ({timeAgo(usage.trackingSince)}). Today is partial.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="row spread"><h3>Customer payments · last 30 days</h3><a className="small" href={`${origin}/v2/location/${locationId}/payments/transactions`} target="_top">Open transactions →</a></div>
        {hasError(payments) ? (
          <p className="muted">{payments.error ?? "No payment data."}</p>
        ) : (
          <>
            <div className="row" style={{ gap: 24, margin: "8px 0 12px" }}>
              <Stat label="Net collected" value={fmt(payments.net, payments.currency)} sub={`${payments.paidCount} payments`} />
              <Stat label="Refunded" value={fmt(payments.refunded, payments.currency)} />
              <Stat label="Failed" value={String(payments.failedCount)} sub={fmt(payments.failedAmount, payments.currency)} tone={payments.failedCount ? "warn" : undefined} />
              {!hasError(subscriptions) && (
                <>
                  <Stat label="Active subscriptions" value={String(subscriptions.active)} sub={`${fmt(subscriptions.activeAmount, payments.currency)} per billing cycle`} />
                  <Stat label="Past due" value={String(subscriptions.pastDue)} tone={subscriptions.pastDue ? "warn" : undefined} sub={`${subscriptions.trialing} trialing · ${subscriptions.canceled} canceled`} />
                </>
              )}
            </div>
            {payments.otherCurrencies && <p className="small muted">Totals shown in {payments.currency}; payments in other currencies are not included.</p>}
            {payments.recentFailed.length > 0 && (
              <div className="tbl">
                <table>
                  <thead><tr><th>Failed payment</th><th>Product / source</th><th>Amount</th><th>When</th></tr></thead>
                  <tbody>
                    {payments.recentFailed.map((p, i) => (
                      <tr key={i}><td>{p.name}</td><td className="muted">{p.source}</td><td>{fmt(p.amount, payments.currency)}</td><td className="small muted">{timeAgo(p.date)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {!hasError(subscriptions) && subscriptions.pastDueList.length > 0 && (
          <div className="tbl" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Past-due subscription</th><th>Product / source</th><th>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {subscriptions.pastDueList.map((p, i) => (
                  <tr key={i}><td>{p.name}</td><td className="muted">{p.source}</td><td>{fmt(p.amount, hasError(payments) ? "USD" : payments.currency)}</td><td><span className="pill t-warn">{p.status?.replace("_", " ")}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasError(subscriptions) && subscriptions.error && <p className="small muted">Subscriptions: {subscriptions.error}</p>}
      </div>
    </div>
  );
}
