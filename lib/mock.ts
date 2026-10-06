// Fake HighLevel API used when GHL_MOCK=true, so the whole app can be tested locally
// without a HighLevel account. Shapes follow the official OpenAPI specs.
import { bump, q } from "./db";

export const DEMO_LOCATION = "demo-location";
export const DEMO_COMPANY = "demo-company";

const H = 3_600_000;
const D = 24 * H;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const workflows = [
  { id: "wf_nurture", name: "New Lead Nurture", status: "published", version: 7, updatedAt: ago(9 * D) },
  { id: "wf_missed_call", name: "Missed Call Text Back", status: "published", version: 3, updatedAt: ago(30 * D) },
  { id: "wf_reminder", name: "Appointment Reminder", status: "published", version: 13, updatedAt: ago(5 * H) },
  { id: "wf_review", name: "Review Request", status: "published", version: 4, updatedAt: ago(12 * D) },
  { id: "wf_reactivation", name: "Database Reactivation", status: "draft", version: 1, updatedAt: ago(41 * D) },
  { id: "wf_black_friday", name: "Black Friday Promo", status: "draft", version: 2, updatedAt: ago(3 * D) },
];

export async function mockGhl<T>(locationId: string, path: string, req: { query?: Record<string, unknown> }): Promise<T> {
  await new Promise((r) => setTimeout(r, 40));
  const qy = req.query ?? {};
  const r = (v: unknown) => v as T;

  if (path === "/workflows/") return r({ workflows: workflows.map((w) => ({ ...w, locationId, createdAt: ago(90 * D) })) });

  if (path.startsWith("/locations/")) return r({ location: { id: locationId, name: "Acme Dental (Demo)" } });

  if (path === "/conversation-ai/agents/search")
    return r({
      agents: [
        { id: "cai_front", name: "Front Desk Bot", mode: "auto-pilot", channels: ["SMS", "WebChat"], actions: [{}] },
        { id: "cai_after", name: "After-hours Bot", mode: "off", channels: ["SMS"], actions: [{}] },
        { id: "cai_fb", name: "Facebook Responder", mode: "suggestive", channels: ["FB"], actions: [] },
      ],
      totalCount: 3,
      count: 3,
    });

  if (path === "/voice-ai/agents")
    return r({
      total: 2,
      agents: [
        { id: "vai_recept", agentName: "Receptionist", inboundNumber: "+15555550101" },
        { id: "vai_sales", agentName: "Sales Qualifier", inboundNumber: "+15555550102" },
      ],
    });

  if (path === "/voice-ai/dashboard/call-logs") return r({ total: qy.agentId === "vai_recept" ? 0 : 23, callLogs: [] });

  if (path === "/calendars/")
    return r({
      calendars: [
        { id: "cal_consult", name: "Free Consultation", isActive: true },
        { id: "cal_cleaning", name: "Teeth Cleaning", isActive: true },
        { id: "cal_old", name: "Old Promo Calendar", isActive: false },
      ],
    });

  if (path.endsWith("/free-slots")) {
    if (path.includes("cal_consult")) return r({ traceId: "x" });
    const day = new Date(Date.now() + D).toISOString().slice(0, 10);
    return r({ [day]: { slots: ["09:00", "10:00", "11:00"] }, traceId: "x" });
  }

  if (path === "/forms/")
    return r({
      forms: [
        { id: "form_contact", name: "Contact Us" },
        { id: "form_quote", name: "Get a Quote" },
        { id: "form_old", name: "Old Survey Form" },
      ],
      total: 3,
    });

  if (path === "/forms/submissions") {
    const map: Record<string, string | null> = { form_contact: ago(6 * D), form_quote: ago(3 * H), form_old: null };
    const at = map[String(qy.formId)];
    return r({ submissions: at ? [{ id: "s1", createdAt: at, formId: qy.formId }] : [], meta: { total: at ? 42 : 0 } });
  }

  if (path === "/conversations/search")
    return r({
      conversations: Array.from({ length: 12 }, (_, i) => ({
        id: `c${i}`,
        contactName: `Contact ${i}`,
        lastMessageDate: Date.now() - (i < 9 ? (26 + i * 3) * H : 2 * H),
        unreadCount: 1,
      })),
      total: 12,
    });

  if (path === "/opportunities/search")
    return r({
      opportunities: Array.from({ length: 52 }, (_, i) => ({
        id: `o${i}`,
        status: "open",
        lastStageChangeAt: ago((i < 37 ? 20 + i : 2) * D),
        createdAt: ago(60 * D),
      })),
      meta: { total: 52 },
    });

  throw new Error(`Mock has no fixture for ${path}`);
}

/** Creates a demo installation with realistic history so every check has something to show. */
export async function seedDemo(): Promise<void> {
  const loc = DEMO_LOCATION;
  // The insert doubles as a lock: only the first concurrent caller seeds.
  const created = await q(
    `insert into installations (location_id, company_id, location_name, access_token, expires_at, installed_at)
     values ($1, $2, 'Acme Dental (Demo)', 'mock', now() + interval '1 year', now() - interval '30 days')
     on conflict (location_id) do nothing returning location_id`,
    [loc, DEMO_COMPANY],
  );
  if (!created.length) return;
  await q(
    `insert into installations (location_id, company_id, location_name, access_token, expires_at, installed_at, last_scanned_at)
     values ('demo-location-2', $1, 'Bright Smiles Ortho (Demo)', 'mock', now() + interval '1 year', now() - interval '30 days', null)
     on conflict (location_id) do nothing`,
    [DEMO_COMPANY],
  );
  const mon: [string, string, number, number][] = [
    ["wf_nurture", "New Lead Nurture", 72, 4 * D],
    ["wf_missed_call", "Missed Call Text Back", 72, 3.2 * D],
    ["wf_reminder", "Appointment Reminder", 24, 2 * H],
    ["wf_review", "Review Request", 168, 20 * H],
  ];
  for (const [id, name, win, lastAgo] of mon) {
    await q(
      `insert into monitored_workflows (location_id, workflow_id, workflow_name, window_hours, first_seen_at, last_seen_at, total_count)
       values ($1, $2, $3, $4, now() - interval '25 days', $5, 500)`,
      [loc, id, name, win, new Date(Date.now() - lastAgo)],
    );
  }
  // 20 days of history for counters
  for (let i = 1; i <= 20; i++) {
    const at = new Date(Date.now() - i * D);
    await bump(loc, "wf:wf_reminder", 30 + (i % 5), at);
    await bump(loc, "wf:wf_review", i === 1 ? 2 : 12, at); // volume drop yesterday
    await bump(loc, "contacts_new", 8 + (i % 4), at);
    await bump(loc, "sms_out", 120, at);
    await bump(loc, "sms_fail", i <= 2 ? 4 : 1, at);
    await bump(loc, "email_out", 200, at);
    await bump(loc, "email_fail", 1, at);
    await bump(loc, "appt:cal_cleaning", 3, at);
  }
  await bump(loc, "contacts_new", 3);
  await bump(loc, "sms_out", 40);
  await bump(loc, "wf:wf_reminder", 12);
  // A workflow that was published before and was switched to draft two days ago
  await q(
    `insert into workflow_status (location_id, workflow_id, status, last_published_at, status_changed_at)
     values ($1, 'wf_black_friday', 'draft', now() - interval '2 days', now() - interval '2 days')`,
    [loc],
  );
}
