"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Issue, ModuleKey, ModuleResult, Severity } from "@/lib/types";
import { scoreBand } from "@/lib/score";
import { api, ghlOrigin, timeAgo, type Auth, type HealthResponse } from "./client";
import { SettingsPanel } from "./SettingsPanel";

const SEV_LABEL: Record<Severity, string> = { critical: "Critical", warning: "Warning", info: "Info" };
const SEV_TONE: Record<Severity, string> = { critical: "t-bad", warning: "t-warn", info: "t-info" };
const TONE_VAR = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", info: "var(--info)" };

function ScoreRing({ score }: { score: number | null }) {
  const band = scoreBand(score);
  const c = 2 * Math.PI * 50;
  const pct = score === null ? 0 : score / 100;
  return (
    <svg width="140" height="140" viewBox="0 0 120 120" role="img" aria-label={`Health score ${score ?? "unknown"} of 100`}>
      <circle cx="60" cy="60" r="50" fill="none" stroke="var(--border)" strokeWidth="12" />
      <circle
        cx="60" cy="60" r="50" fill="none" stroke={TONE_VAR[band.tone]} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - pct)} transform="rotate(-90 60 60)"
      />
      <text x="60" y="60" textAnchor="middle" fontSize="30" fontWeight="700" fill="var(--text)">{score ?? "–"}</text>
      <text x="60" y="80" textAnchor="middle" fontSize="11" fill="var(--muted)">/ 100</text>
    </svg>
  );
}

function Sparkline({ points }: { points: { day: string; score: number }[] }) {
  if (points.length < 2) return null;
  const w = 180, h = 36;
  const xs = (i: number) => (i / (points.length - 1)) * w;
  const ys = (s: number) => h - (s / 100) * (h - 4) - 2;
  const d = points.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.score).toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-label="Score over the last 30 days">
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" />
    </svg>
  );
}

function ModuleCard({ m, active, onClick }: { m: ModuleResult; active: boolean; onClick: () => void }) {
  return (
    <button className={`mod${active ? " active" : ""}`} onClick={onClick} title={m.error ?? undefined}>
      <div className="n"><span className={`dot d-${m.status}`} />{m.label}</div>
      <div className="v">{m.headline}</div>
      <div className="chips">
        {m.status === "error" ? (
          <span className="small muted">{m.error}</span>
        ) : (
          m.chips.map((c) => <span key={c.label} className={`pill t-${c.tone}`}>{c.label}</span>)
        )}
      </div>
    </button>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <div className="issue">
      <span className={`pill sev ${SEV_TONE[issue.severity]}`}>{SEV_LABEL[issue.severity]}</span>
      <div className="body">
        <b>{issue.title}</b>
        {issue.detail && <span>{issue.detail}</span>}
      </div>
      {issue.link && (
        <a href={ghlOrigin() + issue.link} target="_top" rel="noreferrer">Open →</a>
      )}
    </div>
  );
}

export function Dashboard({ locationId, auth, compact = false, onBack }: { locationId: string; auth: Auth; compact?: boolean; onBack?: () => void }) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [tab, setTab] = useState<"overview" | "settings">("overview");
  const [sev, setSev] = useState<Severity | "all">("all");
  const [mod, setMod] = useState<ModuleKey | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<HealthResponse>(`/api/health?locationId=${encodeURIComponent(locationId)}`, auth));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [locationId, auth]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function scanNow() {
    setScanning(true);
    try {
      await api(`/api/health?locationId=${encodeURIComponent(locationId)}`, auth, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setScanning(false);
    }
  }

  const scan = data?.scan ?? null;
  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, info: 0 };
    scan?.issues.forEach((i) => c[i.severity]++);
    return c;
  }, [scan]);
  const issues = (scan?.issues ?? []).filter((i) => (sev === "all" || i.severity === sev) && (!mod || i.module === mod));

  if (error && !data) return <div className="center"><div><h3>Couldn&apos;t load health data</h3><p className="muted">{error}</p><button className="btn" onClick={load}>Retry</button></div></div>;
  if (!data) return <div className="center muted">Running the first health scan… this takes a few seconds.</div>;
  if (!scan) return <div className="center muted">No scan yet. The first scan will run shortly.</div>;

  const band = scoreBand(scan.score);
  const healthy = scan.modules.filter((m) => m.status === "ok").length;

  return (
    <div className={`page${compact ? " compact" : ""}`}>
      <div className="row spread">
        <div>
          {onBack && <button className="btn link small" onClick={onBack}>← All sub-accounts</button>}
          <h2>System Health{data.locationName ? ` · ${data.locationName}` : ""}</h2>
          <div className="muted small">Last scan {timeAgo(scan.scannedAt)} · checks run automatically every 15 minutes</div>
        </div>
        <div className="row">
          {counts.critical > 0 && <span className="pill t-bad">{counts.critical} critical</span>}
          {counts.warning > 0 && <span className="pill t-warn">{counts.warning} warnings</span>}
          <span className="pill t-ok">{healthy} modules healthy</span>
          {!data.readOnly && <button className="btn" onClick={scanNow} disabled={scanning}>{scanning ? "Scanning…" : "Scan now"}</button>}
        </div>
      </div>
      {error && <div className="banner t-bad">{error}</div>}

      {!data.readOnly && !compact && (
        <div className="tabs">
          <button className={tab === "overview" ? "on" : ""} onClick={() => setTab("overview")}>Overview</button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>Settings</button>
        </div>
      )}

      {tab === "settings" ? (
        <SettingsPanel locationId={locationId} auth={auth} onSaved={load} />
      ) : (
        <>
          <div className="top" style={{ marginTop: compact || data.readOnly ? 12 : 0 }}>
            <div className="card score">
              <ScoreRing score={scan.score} />
              <b>{band.label}</b>
              <Sparkline points={data.history} />
              <span className="small muted">{data.history.length > 1 ? "Last 30 days" : "Trend appears after a few days"}</span>
            </div>
            <div className="mods">
              {scan.modules.map((m) => (
                <ModuleCard key={m.key} m={m} active={mod === m.key} onClick={() => setMod(mod === m.key ? null : m.key)} />
              ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="row spread" style={{ marginBottom: 6 }}>
              <h3>Issues{mod ? ` · ${scan.modules.find((m) => m.key === mod)?.label}` : ""}</h3>
              <div className="filters">
                {(["all", "critical", "warning", "info"] as const).map((s) => (
                  <button key={s} className={sev === s ? "on" : ""} onClick={() => setSev(s)}>
                    {s === "all" ? "All" : SEV_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            {issues.length ? (
              issues.map((i) => <IssueRow key={i.key} issue={i} />)
            ) : (
              <div className="issue"><span className="pill sev t-ok">Healthy</span><div className="body"><b>No issues for this filter</b><span>Everything here looks good.</span></div></div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
