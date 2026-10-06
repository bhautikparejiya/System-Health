const isProd = process.env.NODE_ENV === "production";

function required(name: string, devFallback?: string): string {
  const v = process.env[name];
  if (v) return v;
  if (!isProd && devFallback !== undefined) return devFallback;
  throw new Error(`Missing required environment variable ${name}`);
}

export const env = {
  get clientId() {
    return required("GHL_CLIENT_ID", "");
  },
  get clientSecret() {
    return required("GHL_CLIENT_SECRET", "");
  },
  get sharedSecret() {
    return required("GHL_SHARED_SECRET", "");
  },
  get appId() {
    return process.env.GHL_APP_ID || (process.env.GHL_CLIENT_ID ?? "").split("-")[0];
  },
  get baseUrl() {
    // Falls back to the Vercel production domain, then localhost for local development.
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "";
    return (process.env.APP_BASE_URL || vercel || "http://localhost:3000").replace(/\/$/, "");
  },
  get sessionSecret() {
    return required("SESSION_SECRET", "dev-only-session-secret-change-me");
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get actionSecret() {
    return process.env.ACTION_SECRET ?? "";
  },
  get databaseUrl() {
    return process.env.DATABASE_URL ?? "";
  },
  get mock() {
    return process.env.GHL_MOCK === "true";
  },
};
