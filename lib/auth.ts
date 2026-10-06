import { createHmac, timingSafeEqual } from "node:crypto";
import CryptoJS from "crypto-js";
import { q1 } from "./db";
import { env } from "./env";

/** Decrypted HighLevel user context (Custom Page → postMessage REQUEST_USER_DATA). */
export interface GhlUserContext {
  userId: string;
  companyId: string;
  role?: string;
  type: "agency" | "location";
  activeLocation?: string;
  userName?: string;
  email?: string;
}

export function decryptUserContext(encrypted: string): GhlUserContext {
  const text = CryptoJS.AES.decrypt(encrypted, env.sharedSecret).toString(CryptoJS.enc.Utf8);
  if (!text) throw new Error("Could not decrypt user context (wrong Shared Secret?)");
  return JSON.parse(text) as GhlUserContext;
}

export interface Session {
  userId: string;
  companyId: string;
  /** Present when opened inside a sub-account */
  locationId?: string;
  role?: string;
  name?: string;
  exp: number;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (data: string) => createHmac("sha256", env.sessionSecret).update(data).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Stateless signed session token. Sent as a Bearer header because third-party cookies are blocked in iframes. */
export function createSession(s: Omit<Session, "exp">, ttlSeconds = 8 * 3600): string {
  const body = b64(JSON.stringify({ ...s, exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${body}.${sign(body)}`;
}

export function readSession(token: string | null | undefined): Session | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;
  const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
  return s.exp * 1000 > Date.now() ? s : null;
}

/** Read-only key for the dashboard Embed widget URL (/embed?l=<locationId>&k=<key>). */
export function embedKey(locationId: string): string {
  return createHmac("sha256", env.sessionSecret).update(`embed:${locationId}`).digest("hex").slice(0, 32);
}

export type Access = { kind: "session"; session: Session } | { kind: "embed" };

/**
 * Checks that the caller may see `locationId`:
 *  - a session opened inside that sub-account, or
 *  - an agency session whose company owns the installation, or
 *  - a valid embed key (read-only).
 */
export async function authorize(req: Request, locationId: string | null): Promise<Access | null> {
  if (!locationId) return null;
  const url = new URL(req.url);
  const k = url.searchParams.get("k");
  if (k && safeEqual(k, embedKey(locationId))) return { kind: "embed" };

  const auth = req.headers.get("authorization");
  const session = readSession(auth?.startsWith("Bearer ") ? auth.slice(7) : null);
  if (!session) return null;
  if (session.locationId === locationId) return { kind: "session", session };
  if (!session.locationId) {
    const inst = await q1(`select company_id from installations where location_id = $1`, [locationId]);
    if (inst && inst.company_id === session.companyId) return { kind: "session", session };
  }
  return null;
}

export function sessionFrom(req: Request): Session | null {
  const auth = req.headers.get("authorization");
  return readSession(auth?.startsWith("Bearer ") ? auth.slice(7) : null);
}
