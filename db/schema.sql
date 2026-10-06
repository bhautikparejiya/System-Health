-- GHL Health Monitor schema. Idempotent: safe to run on every deploy.

-- Agency (Company) level OAuth tokens, used for bulk installs to mint location tokens.
create table if not exists companies (
  company_id        text primary key,
  access_token      text not null,
  refresh_token     text,
  expires_at        timestamptz not null,
  scopes            text,
  install_to_future boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One row per sub-account (location) where the app is installed.
create table if not exists installations (
  location_id      text primary key,
  company_id       text,
  location_name    text,
  access_token     text,
  refresh_token    text,
  expires_at       timestamptz,
  scopes           text,
  plan_id          text,
  installed_at     timestamptz not null default now(),
  last_scanned_at  timestamptz,
  scan_lock_until  timestamptz
);
create index if not exists installations_company_idx on installations (company_id);

create table if not exists location_settings (
  location_id text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Workflows watched for inactivity. Rows are created automatically on the first
-- "Health Check-in" action call, or manually from the Settings tab.
create table if not exists monitored_workflows (
  location_id    text not null,
  workflow_id    text not null,
  workflow_name  text,
  window_hours   integer not null default 72,
  enabled        boolean not null default true,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz,
  total_count    bigint not null default 0,
  primary key (location_id, workflow_id)
);

-- Daily event counters (UTC days): wf:<id>, contacts_new, sms_out, sms_fail, email_out, email_fail, appt:<calendarId>
create table if not exists daily_counters (
  location_id text not null,
  day         date not null,
  metric      text not null,
  count       integer not null default 0,
  primary key (location_id, day, metric)
);

-- Last known workflow status, used to detect "was published, now draft".
create table if not exists workflow_status (
  location_id        text not null,
  workflow_id        text not null,
  status             text not null,
  last_published_at  timestamptz,
  status_changed_at  timestamptz,
  primary key (location_id, workflow_id)
);

-- Latest scan result per location.
create table if not exists scans (
  location_id text primary key,
  scanned_at  timestamptz not null,
  score       integer,
  result      jsonb not null
);

create table if not exists score_history (
  location_id text not null,
  day         date not null,
  score       integer not null,
  primary key (location_id, day)
);

-- Workflows that use our "Health issue detected" custom trigger.
create table if not exists trigger_subscriptions (
  id           text primary key,
  location_id  text not null,
  workflow_id  text,
  trigger_key  text,
  target_url   text not null,
  filters      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists trigger_subscriptions_location_idx on trigger_subscriptions (location_id);

-- Issues that are currently open and have already been alerted (so we only alert on new ones).
create table if not exists alert_log (
  location_id     text not null,
  issue_key       text not null,
  first_seen_at   timestamptz not null default now(),
  last_alerted_at timestamptz,
  primary key (location_id, issue_key)
);

-- Webhook replay protection.
create table if not exists processed_webhooks (
  webhook_id  text primary key,
  received_at timestamptz not null default now()
);
