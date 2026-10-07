// Reads the sub-account's own payments (its customers paying it) and wallet status from HighLevel.
import { V } from "./ghl";
import type { GhlRequest } from "./ghl";

type Api = <T>(path: string, req: GhlRequest) => Promise<T>;

export interface Transaction {
  _id: string;
  contactName?: string;
  currency?: string;
  amount?: number;
  amountRefunded?: number;
  status?: unknown;
  entitySourceName?: string;
  createdAt?: string;
}

export interface Subscription {
  _id: string;
  contactName?: string;
  currency?: string;
  amount?: number;
  status?: unknown;
  entitySourceName?: string;
  createdAt?: string;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
export const statusOf = (s: unknown) => String(s ?? "").toLowerCase();

/** Live-mode transactions created in the last `days` days (max 500). */
export async function fetchTransactions(api: Api, locationId: string, days: number, now = new Date()): Promise<Transaction[]> {
  const out: Transaction[] = [];
  for (let page = 0; page < 5; page++) {
    const res = await api<{ data?: Transaction[] }>("/payments/transactions", {
      version: V.payments,
      query: {
        altId: locationId,
        altType: "location",
        paymentMode: "live",
        startAt: day(new Date(now.getTime() - days * 86_400_000)),
        endAt: day(new Date(now.getTime() + 86_400_000)),
        limit: 100,
        offset: page * 100,
      },
    });
    const batch = res.data ?? [];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/** Live-mode subscriptions (max 300). */
export async function fetchSubscriptions(api: Api, locationId: string): Promise<Subscription[]> {
  const out: Subscription[] = [];
  for (let page = 0; page < 3; page++) {
    const res = await api<{ data?: Subscription[] }>("/payments/subscriptions", {
      version: V.payments,
      query: { altId: locationId, altType: "location", paymentMode: "live", limit: 100, offset: page * 100 },
    });
    const batch = res.data ?? [];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/** HighLevel only says whether the wallet has funds; it does not expose the balance. */
export async function fetchHasFunds(api: Api): Promise<boolean | null> {
  const r = await api<{ hasFunds?: boolean }>("/marketplace/billing/charges/has-funds", { version: V.marketplace });
  return typeof r.hasFunds === "boolean" ? r.hasFunds : null;
}

export function summarizeTransactions(txns: Transaction[]) {
  const currencies = new Map<string, number>();
  for (const t of txns) if (t.currency) currencies.set(t.currency.toUpperCase(), (currencies.get(t.currency.toUpperCase()) ?? 0) + 1);
  const currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  const inCurrency = txns.filter((t) => !t.currency || t.currency.toUpperCase() === currency);
  const succeeded = inCurrency.filter((t) => ["succeeded", "paid", "success", "refunded", "partially_refunded"].includes(statusOf(t.status)));
  const failed = inCurrency.filter((t) => ["failed", "declined"].includes(statusOf(t.status)));
  const refunded = inCurrency.reduce((s, t) => s + (t.amountRefunded ?? 0), 0);
  const gross = succeeded.reduce((s, t) => s + (t.amount ?? 0), 0);
  return {
    currency,
    otherCurrencies: currencies.size > 1,
    paidCount: succeeded.length,
    gross,
    refunded,
    net: gross - refunded,
    failed,
    failedAmount: failed.reduce((s, t) => s + (t.amount ?? 0), 0),
  };
}

export function summarizeSubscriptions(subs: Subscription[]) {
  const by = (states: string[]) => subs.filter((s) => states.includes(statusOf(s.status)));
  return {
    active: by(["active"]),
    trialing: by(["trialing"]),
    pastDue: by(["past_due", "unpaid", "incomplete"]),
    canceled: by(["canceled", "cancelled", "incomplete_expired"]),
    total: subs.length,
  };
}

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}
