-- realtime_doctor -- Migration 0004: recurring billing cycle support (S4).
--
-- Scope: the three things the webhook + watchdog need that 0002/0003 do not
-- provide. Nothing here relaxes the privilege posture of 0002 -- every new
-- object is service_role only, and no GRANT or policy is added to
-- public.subscriptions.
--
--   1. subscriptions.billing_anchor_day  -- the day-of-month the doctor is
--      billed on, so a 31st subscriber does not erode to the 28th.
--   2. webhook_events.{processing_error, attempt_count}  -- a claimed-but-never
--      -finished event has to be visible. Without this a crash mid-processing
--      leaves a row that looks exactly like a processed one.
--   3. subscription_watchdog_runs  -- the watchdog writes a row on EVERY run,
--      including the ones that find nothing. "zero problems today" and "the job
--      has not run since March" must not look the same in the database.

-- ---------------------------------------------------------------------------
-- 1) Billing anchor day
-- ---------------------------------------------------------------------------
-- Why store it instead of deriving it from current_period_start each time:
--   Deriving erodes. A subscription anchored on the 31st is clamped to Feb 28,
--   and if the next period is then derived from *that* start it stays on the
--   28th forever. The doctor silently moves to a different billing date, which
--   is the kind of drift nobody reports and nobody notices.
-- 1..31; the clamp to each month's last day happens at computation time
-- (admin-web/lib/billing/period.ts).
alter table public.subscriptions
  add column if not exists billing_anchor_day smallint
    check (billing_anchor_day is null or (billing_anchor_day between 1 and 31));

comment on column public.subscriptions.billing_anchor_day is
  'Day-of-month (UTC) the subscription is billed on, fixed at first payment. Clamped to the month length at computation time, never rewritten downward.';

-- Backfill for rows that already went through S3 (they were activated before
-- this column existed). No-op on a fresh database.
update public.subscriptions
   set billing_anchor_day = extract(day from current_period_start at time zone 'UTC')::smallint
 where billing_anchor_day is null
   and current_period_start is not null
   and billing_key is not null;

-- ---------------------------------------------------------------------------
-- 2) Webhook processing outcome
-- ---------------------------------------------------------------------------
alter table public.webhook_events
  add column if not exists processing_error text,
  add column if not exists attempt_count integer not null default 0;

comment on column public.webhook_events.processing_error is
  'Non-null when handling threw. The row is still claimed (PortOne gets its 200) but this makes the failure findable instead of silent.';
comment on column public.webhook_events.attempt_count is
  'Incremented each time PortOne redelivers this event id. >1 means our 200 did not get through, which is worth knowing.';

-- ---------------------------------------------------------------------------
-- 3) Watchdog run log
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_watchdog_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  checked_count integer not null default 0,
  missing_count integer not null default 0,
  repaired_count integer not null default 0,
  failed_count  integer not null default 0,
  details       jsonb not null default '[]'::jsonb,
  error         text
);

comment on table public.subscription_watchdog_runs is
  'One row per watchdog execution, written even when nothing was wrong. A silent zero must be distinguishable from a job that never ran.';
comment on column public.subscription_watchdog_runs.details is
  'Per-subscription findings: [{userId, issue, action, paymentId, timeToPay, error}]. Contains no billing key.';

create index if not exists subscription_watchdog_runs_started_idx
  on public.subscription_watchdog_runs (started_at desc);

alter table public.subscription_watchdog_runs enable row level security;

revoke all on public.subscription_watchdog_runs from anon, authenticated;
grant select, insert, update, delete on public.subscription_watchdog_runs to service_role;
-- No policies for anon/authenticated: operational telemetry, denied twice.

-- ---------------------------------------------------------------------------
-- Index the watchdog's hot path
-- ---------------------------------------------------------------------------
-- The watchdog asks "is there a future scheduled attempt for this user".
create index if not exists payment_attempts_scheduled_idx
  on public.payment_attempts (user_id, scheduled_for desc)
  where status = 'scheduled';
