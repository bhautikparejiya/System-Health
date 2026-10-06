import { NextResponse } from "next/server";
import { sessionFrom } from "@/lib/auth";
import { q } from "@/lib/db";

/** Agency view: every installed sub-account of the caller's agency, worst health first. */
export async function GET(req: Request) {
  const session = sessionFrom(req);
  if (!session || session.locationId) return NextResponse.json({ error: "Agency session required" }, { status: 401 });

  const rows = await q(
    `select i.location_id, i.location_name, s.score, s.scanned_at,
            (select count(*) from jsonb_array_elements(s.result->'issues') e where e->>'severity' = 'critical') as critical,
            (select count(*) from jsonb_array_elements(s.result->'issues') e where e->>'severity' = 'warning') as warning
       from installations i left join scans s on s.location_id = i.location_id
      where i.company_id = $1
      order by s.score asc nulls last, i.location_name`,
    [session.companyId],
  );
  return NextResponse.json({
    locations: rows.map((r) => ({
      locationId: r.location_id,
      name: r.location_name ?? r.location_id,
      score: r.score === null ? null : Number(r.score),
      scannedAt: r.scanned_at,
      critical: Number(r.critical ?? 0),
      warning: Number(r.warning ?? 0),
    })),
  });
}
