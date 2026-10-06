"use client";

import { useEffect, useState } from "react";
import { scoreBand } from "@/lib/score";
import { api, timeAgo, type Auth } from "./client";
import { Dashboard } from "./Dashboard";

interface Loc {
  locationId: string;
  name: string;
  score: number | null;
  scannedAt: string | null;
  critical: number;
  warning: number;
}

export function AgencyView({ auth }: { auth: Auth }) {
  const [locs, setLocs] = useState<Loc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    api<{ locations: Loc[] }>("/api/agency", auth).then((d) => setLocs(d.locations)).catch((e) => setError((e as Error).message));
  }, [auth, open]);

  if (open) return <Dashboard locationId={open} auth={auth} onBack={() => setOpen(null)} />;
  if (error) return <div className="center muted">{error}</div>;
  if (!locs) return <div className="center muted">Loading sub-accounts…</div>;

  const atRisk = locs.filter((l) => l.score !== null && l.score < 70).length;
  return (
    <div className="page">
      <h2>Agency Health Overview</h2>
      <div className="muted small" style={{ marginBottom: 16 }}>
        {locs.length} sub-accounts with the app installed · {atRisk} at risk · sorted worst first
      </div>
      <div className="card tbl">
        <table>
          <thead><tr><th>Sub-account</th><th>Score</th><th>Critical</th><th>Warnings</th><th>Last scan</th><th /></tr></thead>
          <tbody>
            {locs.length === 0 && <tr><td colSpan={6} className="muted">No sub-accounts yet. Install the app on a sub-account to start monitoring.</td></tr>}
            {locs.map((l) => {
              const b = scoreBand(l.score);
              return (
                <tr key={l.locationId}>
                  <td>{l.name}</td>
                  <td><span className={`pill t-${b.tone}`}>{l.score ?? "–"}</span> <span className="small muted">{b.label}</span></td>
                  <td>{l.critical ? <span className="pill t-bad">{l.critical}</span> : 0}</td>
                  <td>{l.warning ? <span className="pill t-warn">{l.warning}</span> : 0}</td>
                  <td className="small muted">{timeAgo(l.scannedAt)}</td>
                  <td><button className="btn small" onClick={() => setOpen(l.locationId)}>Open</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
