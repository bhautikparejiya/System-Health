"use client";

import { useEffect, useState } from "react";
import type { ModuleKey, Severity } from "@/lib/types";
import type { Settings } from "@/lib/settings";
import { api, timeAgo, type Auth, type SettingsResponse } from "./client";

const MODULE_LABELS: Record<ModuleKey, string> = {
  workflows: "Workflows",
  conversationAi: "Conversation AI",
  voiceAi: "Voice AI",
  calendars: "Calendars",
  forms: "Forms",
  inbox: "Inbox",
  pipelines: "Pipelines",
  messaging: "Messaging (SMS / email)",
  leads: "New leads",
  wallet: "Wallet funds",
  payments: "Customer payments",
};

const NUMBERS: { key: keyof Settings; label: string; unit: string; div?: number }[] = [
  { key: "workflowWindowHours", label: "Default workflow inactivity window", unit: "days", div: 24 },
  { key: "voiceIdleDays", label: "Voice AI: alert when no calls for", unit: "days" },
  { key: "formIdleDays", label: "Forms: alert when no submissions for", unit: "days" },
  { key: "calendarLookaheadDays", label: "Calendars: check open slots for the next", unit: "days" },
  { key: "calendarIdleDays", label: "Calendars: alert when no bookings for", unit: "days" },
  { key: "inboxUnansweredHours", label: "Inbox: unanswered after", unit: "hours" },
  { key: "inboxCriticalCount", label: "Inbox: critical when waiting conversations ≥", unit: "" },
  { key: "staleDealDays", label: "Pipelines: deal is stale after", unit: "days" },
  { key: "msgFailWarnPct", label: "Messaging: warning at failure rate", unit: "%" },
  { key: "msgFailCritPct", label: "Messaging: critical at failure rate", unit: "%" },
  { key: "leadsIdleHours", label: "Leads: critical when no new contacts for", unit: "hours" },
  { key: "failedPaymentsWarn", label: "Payments: warning at failed payments (7 days) ≥", unit: "" },
];

export function SettingsPanel({ locationId, auth, onSaved }: { locationId: string; auth: Auth; onSaved: () => void }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [addId, setAddId] = useState("");
  const [addDays, setAddDays] = useState(3);
  const url = `/api/settings?locationId=${encodeURIComponent(locationId)}`;

  useEffect(() => {
    api<SettingsResponse>(url, auth).then((d) => {
      setData(d);
      setDraft(d.settings);
    }).catch((e) => setMsg((e as Error).message));
  }, [url, auth]);

  async function put(body: unknown, note = "Saved") {
    try {
      const d = await api<SettingsResponse>(url, auth, { method: "PUT", body: JSON.stringify(body) });
      setData(d);
      setDraft(d.settings);
      setMsg(note);
      onSaved();
      setTimeout(() => setMsg(null), 2500);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  if (!data || !draft) return <div className="muted">{msg ?? "Loading settings…"}</div>;

  const monitoredIds = new Set(data.monitored.map((m) => m.workflow_id));
  const statusOf = new Map(data.workflows.map((w) => [w.id, w.status]));
  const candidates = data.workflows.filter((w) => !monitoredIds.has(w.id));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {msg && <div className="banner t-info">{msg}</div>}

      <div className="card">
        <h3>Workflow inactivity monitoring</h3>
        <p className="muted small">
          Add the <b>“Health Check-in”</b> action as the <b>first step</b> of any workflow you want watched. Every contact that enters
          pings this app; if nobody enters within the window, you get a critical issue. Workflows appear here automatically after
          their first check-in, or you can add them below.
        </p>
        <div className="tbl">
          <table>
            <thead>
              <tr><th>Workflow</th><th>Status</th><th>Last contact entered</th><th>Total</th><th>Alert after (days)</th><th>On</th><th /></tr>
            </thead>
            <tbody>
              {data.monitored.length === 0 && (
                <tr><td colSpan={7} className="muted">No workflows monitored yet.</td></tr>
              )}
              {data.monitored.map((m) => (
                <tr key={m.workflow_id}>
                  <td>{m.workflow_name ?? m.workflow_id}</td>
                  <td><span className={`pill ${statusOf.get(m.workflow_id) === "published" ? "t-ok" : "t-info"}`}>{statusOf.get(m.workflow_id) ?? "unknown"}</span></td>
                  <td>{m.last_seen_at ? timeAgo(m.last_seen_at) : <span className="muted">no check-in yet</span>}</td>
                  <td>{m.total_count}</td>
                  <td>
                    <input
                      type="number" min={0.25} step={0.25} defaultValue={+(m.window_hours / 24).toFixed(2)}
                      onBlur={(e) => {
                        const days = Number(e.target.value);
                        if (days > 0 && Math.round(days * 24) !== m.window_hours) put({ monitored: [{ workflowId: m.workflow_id, windowHours: days * 24 }] });
                      }}
                    />
                  </td>
                  <td>
                    <input type="checkbox" checked={m.enabled} onChange={(e) => put({ monitored: [{ workflowId: m.workflow_id, windowHours: m.window_hours, enabled: e.target.checked }] })} />
                  </td>
                  <td><button className="btn link small" onClick={() => put({ monitored: [{ workflowId: m.workflow_id, remove: true }] }, "Removed")}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {candidates.length > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            <select value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">Add a workflow…</option>
              {candidates.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.status})</option>)}
            </select>
            <span className="small muted">alert after</span>
            <input type="number" min={0.25} step={0.25} value={addDays} onChange={(e) => setAddDays(Number(e.target.value))} />
            <span className="small muted">days</span>
            <button
              className="btn" disabled={!addId}
              onClick={() => {
                const w = data.workflows.find((x) => x.id === addId);
                put({ monitored: [{ workflowId: addId, name: w?.name, windowHours: addDays * 24 }] }, "Workflow added");
                setAddId("");
              }}
            >Add</button>
          </div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h3>Thresholds</h3>
          {NUMBERS.map((n) => (
            <label className="field" key={n.key}>
              <span>{n.label}</span>
              <span className="row" style={{ flexWrap: "nowrap" }}>
                <input
                  type="number" step="any"
                  value={+((draft[n.key] as number) / (n.div ?? 1)).toFixed(2)}
                  onChange={(e) => setDraft({ ...draft, [n.key]: Number(e.target.value) * (n.div ?? 1) })}
                />
                <span className="small muted" style={{ width: 36 }}>{n.unit}</span>
              </span>
            </label>
          ))}
          <label className="field">
            <span>Flag workflows switched from Published to Draft</span>
            <input type="checkbox" checked={draft.flagUnpublishedWorkflows} onChange={(e) => setDraft({ ...draft, flagUnpublishedWorkflows: e.target.checked })} />
          </label>
          <label className="field">
            <span>Flag Conversation AI agents that are turned off</span>
            <input type="checkbox" checked={draft.flagOffConversationAgents} onChange={(e) => setDraft({ ...draft, flagOffConversationAgents: e.target.checked })} />
          </label>
          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => put({ settings: draft })}>Save thresholds</button>
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card">
            <h3>Checks &amp; score weight</h3>
            <p className="muted small">Turn off checks you don&apos;t need. Weight sets how much each module counts in the overall score.</p>
            {(Object.keys(MODULE_LABELS) as ModuleKey[]).map((k) => (
              <div className="field" key={k}>
                <label className="row"><input type="checkbox" checked={draft.modules[k]} onChange={(e) => setDraft({ ...draft, modules: { ...draft.modules, [k]: e.target.checked } })} />{MODULE_LABELS[k]}</label>
                <input type="number" min={0} max={100} value={draft.weights[k]} onChange={(e) => setDraft({ ...draft, weights: { ...draft.weights, [k]: Number(e.target.value) } })} />
              </div>
            ))}
            <button className="btn primary" style={{ marginTop: 8 }} onClick={() => put({ settings: draft })}>Save checks</button>
          </div>

          <div className="card">
            <h3>Alerts</h3>
            <p className="muted small">
              Build a workflow in HighLevel that starts with the <b>“Health issue detected”</b> trigger and add any action, such as
              Send SMS to the owner, Create task, or Slack. It fires once each time a new issue opens.
            </p>
            <label className="field">
              <span>Fire for issues of at least</span>
              <select
                value={draft.alertMinSeverity}
                onChange={(e) => {
                  const v = e.target.value as Severity;
                  setDraft({ ...draft, alertMinSeverity: v });
                  put({ settings: { alertMinSeverity: v } });
                }}
              >
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
            </label>
          </div>

          <div className="card">
            <h3>Show on the main dashboard</h3>
            <p className="muted small">In HighLevel go to Dashboard → Add Widget → Embed, choose URL and paste this link. It is read-only.</p>
            <code>{data.embedUrl}</code>
            <div style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => navigator.clipboard.writeText(data.embedUrl).then(() => setMsg("Link copied"))}>Copy link</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
