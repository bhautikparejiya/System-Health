# System Health Monitor: HighLevel Marketplace app

One health score per sub-account, shown inside HighLevel, covering these checks:

| Module | What it checks | Source |
|---|---|---|
| Workflows | Draft vs. published, **published → draft changes**, recently edited, **no contacts entered in N days** (per workflow), enrollment volume drops | API + "Health Check-in" action |
| Conversation AI | Agents turned off, agents on with no channels | API |
| Voice AI | Agents with 0 live calls in N days, agents with no phone number | API |
| Calendars | 0 open slots in the next N days, no bookings in N days, inactive calendars | API + webhooks |
| Forms | Forms that used to get submissions but went quiet | API |
| Inbox | Inbound conversations unanswered for more than N hours | API |
| Pipelines | Open deals with no stage change in N days | API |
| Messaging | SMS and email failure rate | Webhooks |
| New leads | No new contacts in ~48h, or a sharp drop vs. normal | Webhooks |
| Wallet | Wallet has no funds (SMS, calls, AI would stop) | API |
| Payments | Failed customer payments (7 days), past-due subscriptions | API |

**Billing tab:** wallet status, 30-day usage (SMS, email, new contacts, Check-in runs), customer payments (net, refunds, failed) and subscriptions (active, past due). HighLevel does not expose the exact wallet balance or per-message cost through its API.

Alerts: a custom workflow trigger, **"Health issue detected"**, fires once for each new issue, so clients can text, email or Slack themselves using normal HighLevel workflows.

---

## 1. Run it locally (no HighLevel account needed)

```bash
npm install
cp .env.example .env.local      # then set GHL_MOCK=true and CRON_SECRET=anything
npm run dev
```

* http://localhost:3000/app?demo=1 shows the sub-account dashboard with realistic fake data.
* http://localhost:3000/app?demo=1&agency=1 shows the agency view (all sub-accounts).
* The **Settings** tab has the embed link for the read-only `/embed` view.
* `npm test` runs the unit tests. `npm run build` runs the production build and type-check.

Locally the app uses an embedded Postgres (PGlite) in `./.data`. Delete that folder to reset the demo.

---

## 2. Deploy to Vercel (free to start)

1. Push this folder to a **GitHub** repository.
2. In Vercel, go to **Add New → Project** and import the repo.
3. **Database:** open the Vercel project, go to **Storage → Create → Neon (Postgres)**, choose the free plan and connect it to the project. This sets `DATABASE_URL` for you. The schema is applied automatically on first request; you can also run `npm run db:migrate`.
4. **Environment variables** (Project → Settings → Environment Variables):

   | Name | Value |
   |---|---|
   | `APP_BASE_URL` | `https://<your-project>.vercel.app` (no trailing slash) |
   | `SESSION_SECRET` | random 32+ characters (`openssl rand -hex 32`) |
   | `CRON_SECRET` | random 32+ characters |
   | `ACTION_SECRET` | random 32+ characters (optional but recommended) |
   | `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_SHARED_SECRET` | from step 3 below |
   | `GHL_MOCK` | `false` |

5. Redeploy after adding the variables.
6. **Scans every 15 minutes:** Vercel's free (Hobby) cron only runs **once a day** (already set up in `vercel.json` as a backstop). For 15-minute scans, use either:
   * **GitHub Actions:** `.github/workflows/health-scan.yml` is included. Add repo secrets `APP_BASE_URL` and `CRON_SECRET`, or
   * **cron-job.org** (free): create a job that calls `POST https://<app>/api/cron/scan` every 15 min with header `Authorization: Bearer <CRON_SECRET>`.

> ⚠️ **Vercel Hobby is for personal, non-commercial use.** Testing and a free beta are fine. Once the app is earning money, upgrade to Vercel Pro (about $20/month), which also allows frequent crons and longer functions.

---

## 3. Create the app in the HighLevel Marketplace

Go to https://marketplace.gohighlevel.com, sign up for a developer account, then **My Apps → Create App**.

**Basic info**
* App type: **Public**. Distribution: **Sub-account** (also allow **Agency** for bulk installs).
* Listing type: Standard for now. Add a White-label version later.

**Advanced settings → Auth**
* **Scopes** (all read-only):
  `workflows.readonly`, `conversation-ai.readonly`, `voice-ai-agents.readonly`, `voice-ai-dashboard.readonly`,
  `calendars.readonly`, `calendars/events.readonly`, `forms.readonly`, `conversations.readonly`,
  `conversations/message.readonly`, `opportunities.readonly`, `contacts.readonly`, `locations.readonly`,
  `oauth.readonly`, `oauth.write` (the last two are needed for agency bulk installs),
  `charges.readonly`, `payments/transactions.readonly`, `payments/subscriptions.readonly` (Billing tab, wallet and payment checks).
* **Redirect URL:** `https://<app>/api/oauth/callback`
* Generate the **Client ID / Client Secret** and copy them into Vercel.
* **Shared Secret:** click *Generate* and copy it into `GHL_SHARED_SECRET` in Vercel.

**Webhooks**
* Default Webhook URL: `https://<app>/api/webhooks/ghl`
* Events: `INSTALL`, `UNINSTALL`, `ContactCreate`, `OutboundMessage`, `LCEmailStats`, `AppointmentCreate`

**Custom Page** (the dashboard)
* Name: *System Health*. URL: `https://<app>/app`

**Workflow Action**: "Health Check-in"
* Execution URL: `https://<app>/api/actions/checkin`
* Header (if you set `ACTION_SECRET`): `x-health-secret: <ACTION_SECRET>`
* Field (optional): key `window_days`, type Number, label "Alert if no contacts for (days)"
* Description: "Add as the first step. Alerts you if no contact enters this workflow within the window."

**Workflow Trigger**: "Health issue detected"
* Subscription URL: `https://<app>/api/triggers/subscribe`
* Sample payload (makes these fields available as custom variables in the workflow):
  ```json
  { "issue_key": "wf-idle:abc", "severity": "critical", "module": "workflows",
    "title": "“New Lead Nurture” – no contacts entered in 4 days", "detail": "Threshold: 3 days",
    "health_score": 72, "location_id": "abc123", "detected_at": "2026-10-06T07:15:00.000Z" }
  ```

**Pricing:** start with Free during the beta. Later add Freemium or a monthly subscription with a 14-day trial.

---

## 4. Test it in a real HighLevel account

Use a **sandbox/test sub-account**. You can create a free developer test agency from the Marketplace portal.

1. **Install:** in the Marketplace portal open your app and click the install / preview link, then choose your test sub-account. You should land on `/installed` with ✅.
2. **Open the dashboard:** in the sub-account's left menu click **System Health**. The first scan runs and the score appears.
   * If it says "Couldn't verify your HighLevel session", check that `GHL_SHARED_SECRET` matches the portal.
3. **Workflow status:** set a published workflow to Draft, then click **Scan now**. A warning should appear: "was switched from Published to Draft".
4. **Inactivity alert:**
   * Create a workflow (e.g. trigger *Contact Tag added = test-health*) with **Health Check-in** as the first action. Leave `window_days` empty and publish it.
   * Add the tag to a contact. In **Settings → Workflow inactivity monitoring** the workflow appears with "Last contact entered: just now".
   * To test the alert quickly, set "Alert after" to `0.25` days in Settings. About 6 hours later (on the next scan after that), a **Critical** issue appears.
   * Note: if `window_days` is filled in on the action, it overrides the Settings value on every check-in.
5. **Alerts:** create a workflow with trigger **Health issue detected** and action *Send internal notification / SMS to yourself*. Publish it, then cause any new issue. You should receive the message.
6. **Webhooks:** create a contact and send an SMS. In Vercel → Logs, `/api/webhooks/ghl` should return 200 (not 401).
7. **Embed on the main dashboard:** copy the link from Settings, then in HighLevel go to Dashboard → Add Widget → Embed → URL and paste it.
8. **Agency view:** install at agency level (bulk). Open the app from the agency view to see every sub-account ranked by score.
9. **Uninstall:** uninstall from the sub-account. Its rows disappear from the database (needed for review).

**Troubleshooting:** a module card showing "check failed" with *Permission missing* means a scope wasn't granted. Add the scope in the portal and reinstall. Vercel → Logs shows `[scan]` errors with the exact HighLevel response.

---

## 5. Publish to the Marketplace

1. Replace the placeholders in `/privacy` and `/terms` (`app/privacy/page.tsx`, `app/terms/page.tsx`) with your company name and support email.
2. Prepare the listing: app name, icon (512×512), 3–5 screenshots of the dashboard, short and long description, categories, and support email or phone (**first reply within 24h** is required).
3. Record a **Loom demo video** showing install → open System Health → add the Check-in action → alert firing → uninstall.
4. Write setup instructions (copy section 4, steps 2–5).
5. Run a private beta with 5–10 agencies on free pricing and fix what they report.
6. Set pricing and submit for review in the portal. Review checks: minimal scopes, HTTPS, working install, uninstall cleanup, responsive embedded page, and no secrets in the browser.
7. After approval: announce in HighLevel communities, add the white-label listing, and switch Vercel to Pro once you're charging.

---

## Project layout

```
app/                     Next.js routes
  app/                   Custom Page (SSO handshake → dashboard or agency view)
  embed/                 Read-only view for the dashboard Embed widget
  api/oauth/callback     OAuth install (location + agency/bulk)
  api/auth/sso           Decrypts HighLevel user context → session token
  api/health             GET latest result · POST "Scan now"
  api/settings           Thresholds, checks, monitored workflows
  api/agency             Agency overview
  api/webhooks/ghl       Signed webhooks (Ed25519), install/uninstall, event counters
  api/actions/checkin    "Health Check-in" workflow action
  api/triggers/subscribe "Health issue detected" trigger subscriptions
  api/cron/scan          Scheduled scans
lib/checks/              One file per module group
lib/scan.ts              Runs checks, scores, stores, alerts
lib/ghl.ts               HighLevel client: tokens, refresh, 429 retry
lib/mock.ts              Fake HighLevel for local testing
db/schema.sql            Postgres schema (auto-applied)
```
