import { NextResponse } from "next/server";
import { createSession, decryptUserContext } from "@/lib/auth";
import { q1 } from "@/lib/db";
import { env } from "@/lib/env";
import { DEMO_COMPANY, DEMO_LOCATION, seedDemo } from "@/lib/mock";

/**
 * Exchanges the encrypted HighLevel user context (from the Custom Page postMessage handshake)
 * for a short-lived session token used by the widget's API calls.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { encryptedData?: string; demo?: boolean };

  if (body.demo) {
    if (!env.mock) return NextResponse.json({ error: "Demo login is only available with GHL_MOCK=true" }, { status: 403 });
    await seedDemo();
    const agency = new URL(req.url).searchParams.get("agency") === "1";
    return NextResponse.json({
      token: createSession({ userId: "demo-user", companyId: DEMO_COMPANY, locationId: agency ? undefined : DEMO_LOCATION, role: "admin", name: "Demo Admin" }),
      context: { type: agency ? "agency" : "location", locationId: agency ? null : DEMO_LOCATION, companyId: DEMO_COMPANY, userName: "Demo Admin", installed: true },
    });
  }

  if (!body.encryptedData) return NextResponse.json({ error: "Missing encryptedData" }, { status: 400 });
  for (const name of ["GHL_SHARED_SECRET", "SESSION_SECRET"]) {
    if (!process.env[name]) {
      return NextResponse.json({ error: `Server setup: ${name} is not set in Vercel. Add it and redeploy.` }, { status: 500 });
    }
  }
  let ctx;
  try {
    ctx = decryptUserContext(body.encryptedData);
  } catch {
    return NextResponse.json(
      { error: "Could not read your HighLevel session. Check that GHL_SHARED_SECRET matches the Shared Secret in the developer portal." },
      { status: 401 },
    );
  }

  try {
    const locationId = ctx.activeLocation ?? null;
    const installed = locationId
      ? !!(await q1(`select 1 from installations where location_id = $1`, [locationId]))
      : !!(await q1(`select 1 from installations where company_id = $1 limit 1`, [ctx.companyId]));

    return NextResponse.json({
      token: createSession({ userId: ctx.userId, companyId: ctx.companyId, locationId: locationId ?? undefined, role: ctx.role, name: ctx.userName }),
      context: { type: locationId ? "location" : "agency", locationId, companyId: ctx.companyId, userName: ctx.userName, installed },
    });
  } catch (e) {
    console.error("[sso] failed", e);
    return NextResponse.json({ error: `Server error: ${(e as Error).message}` }, { status: 500 });
  }
}
