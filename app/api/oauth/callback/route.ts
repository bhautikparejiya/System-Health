import { NextResponse } from "next/server";
import { q } from "@/lib/db";
import { exchangeCode, listInstalledLocations, saveCompanyToken, saveLocationToken } from "@/lib/ghl";
import { env } from "@/lib/env";

/**
 * OAuth redirect URL. Configure in the Marketplace app as:  {APP_BASE_URL}/api/oauth/callback
 * Handles both sub-account installs (Location token) and agency/bulk installs (Company token).
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.json({ error: "Missing ?code" }, { status: 400 });

  try {
    const token = await exchangeCode(code);
    let count = 0;
    if (token.userType === "Location" && token.locationId) {
      await saveLocationToken(token, token.companyId);
      count = 1;
    } else if (token.companyId) {
      await saveCompanyToken(token);
      // Register every sub-account the agency installed us on; location tokens are minted on demand.
      const locations = await listInstalledLocations(token.companyId);
      for (const l of locations) {
        await q(
          `insert into installations (location_id, company_id, location_name) values ($1, $2, $3)
           on conflict (location_id) do update set company_id = excluded.company_id,
             location_name = coalesce(installations.location_name, excluded.location_name)`,
          [l._id, token.companyId, l.name ?? null],
        );
      }
      count = locations.length;
    } else {
      throw new Error("Token response had neither locationId nor companyId");
    }
    return NextResponse.redirect(`${env.baseUrl}/installed?count=${count}`);
  } catch (e) {
    console.error("[oauth] install failed", e);
    return NextResponse.redirect(`${env.baseUrl}/installed?error=1`);
  }
}
