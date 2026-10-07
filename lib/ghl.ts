import { q, q1 } from "./db";
import { env } from "./env";
import { mockGhl } from "./mock";

export const GHL_BASE = "https://services.leadconnectorhq.com";

/** API "Version" header per resource, from the official OpenAPI specs. */
export const V = {
  oauth: "2021-07-28",
  locations: "2021-07-28",
  workflows: "2021-07-28",
  forms: "2021-07-28",
  opportunities: "2021-07-28",
  calendars: "2021-04-15",
  conversations: "2021-04-15",
  voiceAi: "2021-04-15",
  conversationAi: "2021-04-15",
  payments: "2021-07-28",
  marketplace: "2021-07-28",
} as const;

export class GhlError extends Error {
  constructor(
    public status: number,
    public body: string,
    public path: string,
  ) {
    super(`HighLevel API ${status} on ${path}: ${body.slice(0, 300)}`);
  }
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  userType?: "Company" | "Location";
  locationId?: string;
  companyId?: string;
  userId?: string;
  planId?: string;
  isBulkInstallation?: boolean;
  installToFutureLocations?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const expiresAt = (seconds: number) => new Date(Date.now() + Math.max(60, seconds) * 1000);
/** Refresh tokens a few minutes before they expire. */
const isFresh = (d: Date | string | null | undefined) => !!d && new Date(d).getTime() - Date.now() > 5 * 60_000;

async function postForm<T>(path: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(GHL_BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", ...headers },
    body: new URLSearchParams(form).toString(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new GhlError(res.status, text, path);
  return JSON.parse(text) as T;
}

/** OAuth: exchange the authorization code from the install redirect. */
export function exchangeCode(code: string): Promise<TokenResponse> {
  return postForm<TokenResponse>("/oauth/token", {
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: `${env.baseUrl}/api/oauth/callback`,
  });
}

function refresh(refreshToken: string, userType: "Company" | "Location"): Promise<TokenResponse> {
  return postForm<TokenResponse>("/oauth/token", {
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    user_type: userType,
  });
}

export async function saveCompanyToken(t: TokenResponse): Promise<void> {
  await q(
    `insert into companies (company_id, access_token, refresh_token, expires_at, scopes, install_to_future)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (company_id) do update set access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at, scopes = excluded.scopes, install_to_future = excluded.install_to_future, updated_at = now()`,
    [t.companyId, t.access_token, t.refresh_token ?? null, expiresAt(t.expires_in), t.scope ?? null, !!t.installToFutureLocations],
  );
}

export async function saveLocationToken(t: TokenResponse, companyId?: string | null): Promise<void> {
  await q(
    `insert into installations (location_id, company_id, access_token, refresh_token, expires_at, scopes, plan_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (location_id) do update set company_id = coalesce(excluded.company_id, installations.company_id),
       access_token = excluded.access_token, refresh_token = coalesce(excluded.refresh_token, installations.refresh_token),
       expires_at = excluded.expires_at, scopes = coalesce(excluded.scopes, installations.scopes),
       plan_id = coalesce(excluded.plan_id, installations.plan_id)`,
    [t.locationId, companyId ?? t.companyId ?? null, t.access_token, t.refresh_token ?? null, expiresAt(t.expires_in), t.scope ?? null, t.planId ?? null],
  );
}

// In-process de-duplication so parallel requests don't refresh the same (single-use) refresh token twice.
const inflight = new Map<string, Promise<string>>();
function once(key: string, fn: () => Promise<string>): Promise<string> {
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function getCompanyToken(companyId: string, force = false): Promise<string> {
  const row = await q1(`select * from companies where company_id = $1`, [companyId]);
  if (!row) throw new Error(`No agency token stored for company ${companyId}`);
  if (!force && isFresh(row.expires_at)) return row.access_token;
  return once(`company:${companyId}`, async () => {
    try {
      const t = await refresh(row.refresh_token, "Company");
      await saveCompanyToken({ ...t, companyId });
      return t.access_token;
    } catch (e) {
      // Another instance may have rotated the token already.
      const again = await q1(`select * from companies where company_id = $1`, [companyId]);
      if (again && again.access_token !== row.access_token && isFresh(again.expires_at)) return again.access_token;
      throw e;
    }
  });
}

/** Returns a valid location access token, refreshing or minting one from the agency token as needed. */
export async function getLocationToken(locationId: string, force = false): Promise<string> {
  const row = await q1(`select * from installations where location_id = $1`, [locationId]);
  if (!row) throw new Error(`App is not installed for location ${locationId}`);
  if (!force && row.access_token && isFresh(row.expires_at)) return row.access_token;

  return once(`location:${locationId}`, async () => {
    if (row.refresh_token) {
      try {
        const t = await refresh(row.refresh_token, "Location");
        await saveLocationToken({ ...t, locationId }, row.company_id);
        return t.access_token;
      } catch (e) {
        const again = await q1(`select * from installations where location_id = $1`, [locationId]);
        if (again?.access_token && again.access_token !== row.access_token && isFresh(again.expires_at)) return again.access_token;
        if (!row.company_id) throw e;
      }
    }
    if (!row.company_id) throw new Error(`No way to obtain a token for location ${locationId}`);
    // Bulk / agency install: mint a location token from the agency token.
    const companyToken = await getCompanyToken(row.company_id);
    const t = await postForm<TokenResponse>(
      "/oauth/locationToken",
      { companyId: row.company_id, locationId },
      { Authorization: `Bearer ${companyToken}`, Version: V.oauth },
    );
    await q(`update installations set access_token = $2, expires_at = $3, scopes = coalesce($4, scopes) where location_id = $1`, [
      locationId,
      t.access_token,
      expiresAt(t.expires_in),
      t.scope ?? null,
    ]);
    return t.access_token;
  });
}

export interface GhlRequest {
  version: string;
  query?: Record<string, string | number | boolean | undefined>;
  method?: "GET" | "POST";
  body?: unknown;
}

/** Authenticated request to the HighLevel API on behalf of a location, with 429 retry and one token refresh on 401. */
export async function ghl<T>(locationId: string, path: string, req: GhlRequest): Promise<T> {
  if (env.mock) return mockGhl<T>(locationId, path, req);

  const url = new URL(GHL_BASE + path);
  for (const [k, v] of Object.entries(req.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  let token = await getLocationToken(locationId);
  let refreshed = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: req.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: req.version,
        Accept: "application/json",
        ...(req.body ? { "Content-Type": "application/json" } : {}),
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
      cache: "no-store",
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      token = await getLocationToken(locationId, true);
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new GhlError(res.status, text, path);
    return (text ? JSON.parse(text) : {}) as T;
  }
  throw new GhlError(429, "Rate limited after retries", path);
}

/** Lists locations where the app is installed for an agency (used after an agency-level install). */
export async function listInstalledLocations(companyId: string): Promise<{ _id: string; name: string }[]> {
  const token = await getCompanyToken(companyId);
  const out: { _id: string; name: string }[] = [];
  for (let skip = 0; skip < 5000; skip += 100) {
    const url = new URL(GHL_BASE + "/oauth/installedLocations");
    url.search = new URLSearchParams({ companyId, appId: env.appId, isInstalled: "true", limit: "100", skip: String(skip) }).toString();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Version: V.oauth, Accept: "application/json" }, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new GhlError(res.status, text, "/oauth/installedLocations");
    const page = (JSON.parse(text).locations ?? []) as { _id: string; name: string }[];
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

/** Fires a custom workflow trigger subscription (target URL is always a HighLevel URL, validated on subscribe). */
export async function fireTrigger(locationId: string, targetUrl: string, payload: unknown): Promise<void> {
  if (env.mock) return;
  const token = await getLocationToken(locationId);
  const res = await fetch(targetUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Version: V.workflows, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) throw new GhlError(res.status, await res.text(), "trigger");
}
