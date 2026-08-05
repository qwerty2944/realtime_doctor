-- realtime_doctor -- Migration 0005: dunning ladder, cancellation, device limit (S5).
--
-- Scope: the state the S5 logic needs that 0002/0004 do not carry. As in 0004,
-- nothing here relaxes the privilege posture of 0002 -- every new column on
-- subscriptions stays service_role only, and public.devices is added with
-- read-only client access from the start.
--
--   1. subscriptions.dunning_*        -- which retry rung we are on, and for
--      which billing cycle. Without this a retry storm is one cron bug away.
--   2. subscriptions.cancel_*         -- cancellation bookkeeping.
--   3. payment_attempts.portone_schedule_id / attempt_kind / dunning_rung
--      -- you cannot cancel a PortOne schedule you did not record the id of.
--   4. webhook_events.reprocess_count -- bounded retry of failed processing.
--   5. public.devices                 -- the table src/main/device.ts has always
--      used but which has never had a migration in this repo.

-- ---------------------------------------------------------------------------
-- 1) Dunning state
-- ---------------------------------------------------------------------------
-- Why the rung is stored rather than derived from payment_attempts:
--   Deriving it means "count the failed attempts since grace opened", which is
--   a query whose answer changes if a webhook is redelivered, if the watchdog
--   also scheduled something, or if the doctor paid manually in between. The
--   ladder must be advanced by a single conditional UPDATE that only one caller
--   can win -- that requires a column.
--
-- dunning_cycle_end is the collision key. It records WHICH billing period this
-- dunning run is trying to collect. Any charge path that wants to bill a period
-- compares against it, so "the watchdog's overdue recovery" and "a dunning
-- retry" can never both be aimed at the same period.
alter table public.subscriptions
  add column if not exists dunning_rung smallint not null default 0
    check (dunning_rung between 0 and 3),
  add column if not exists dunning_started_at timestamptz,
  add column if not exists dunning_cycle_end timestamptz;

comment on column public.subscriptions.dunning_rung is
  'Retry ladder position: 0 = not in dunning, 1..3 = the D+1 / D+3 / D+5 retry has been scheduled. Advanced by a conditional UPDATE so two cron runs cannot both fire the same rung.';
comment on column public.subscriptions.dunning_started_at is
  'When the current dunning run began (the first failure). Rung due-times are computed from this, not from now().';
comment on column public.subscriptions.dunning_cycle_end is
  'The current_period_end this dunning run is collecting for. Collision key between the dunning ladder and the watchdog overdue path.';

create index if not exists subscriptions_dunning_idx
  on public.subscriptions (dunning_started_at)
  where status = 'past_due';

-- ---------------------------------------------------------------------------
-- 2) Cancellation
-- ---------------------------------------------------------------------------
-- cancel_at_period_end already exists (0002). What is missing is *when* it was
-- requested and when the lapse actually happened -- both are needed to answer
-- "did we stop charging them when they asked?" months later.
alter table public.subscriptions
  add column if not exists cancel_requested_at timestamptz,
  add column if not exists canceled_at timestamptz;

comment on column public.subscriptions.cancel_requested_at is
  'When the doctor asked to cancel. Cleared on un-cancel. Access continues until current_period_end regardless.';
comment on column public.subscriptions.canceled_at is
  'When the paid period actually lapsed and status became canceled. Set by the watchdog, not at request time.';

-- ---------------------------------------------------------------------------
-- 3) Attempt provenance and the PortOne schedule id
-- ---------------------------------------------------------------------------
-- [HARD] Without portone_schedule_id, "cancel the subscription" cannot actually
-- stop the upcoming charge: PortOne's revoke API takes schedule ids, and the
-- only moment we ever see one is the response to the schedule call. Dropping it
-- on the floor there means the card still gets charged after cancellation.
alter table public.payment_attempts
  add column if not exists portone_schedule_id text,
  add column if not exists attempt_kind text not null default 'cycle',
  add column if not exists dunning_rung smallint;

comment on column public.payment_attempts.portone_schedule_id is
  'PortOne schedule id from POST /payments/{id}/schedule. Required to revoke the schedule on cancellation.';
comment on column public.payment_attempts.attempt_kind is
  'first | cycle | dunning_retry. Distinguishes the regular monthly schedule from a dunning rung so the two can never be confused for one another.';
comment on column public.payment_attempts.dunning_rung is
  'Which retry rung produced this attempt (1..3). Null for regular cycle attempts.';

-- ---------------------------------------------------------------------------
-- 4) Webhook reprocessing
-- ---------------------------------------------------------------------------
-- 0004 made a failed handler *visible* (processing_error). It did not make it
-- recoverable. PortOne already got its 200 and will never redeliver, so the
-- only thing that can finish the work is us. Bounded, so a permanently broken
-- event does not get retried forever and does not hide behind an infinite loop.
alter table public.webhook_events
  add column if not exists reprocess_count integer not null default 0,
  add column if not exists last_reprocess_at timestamptz;

comment on column public.webhook_events.reprocess_count is
  'How many times the watchdog has re-run handling for this event. Bounded; once the cap is hit the row is reported as unrecovered instead of retried silently.';

create index if not exists webhook_events_failed_idx
  on public.webhook_events (received_at)
  where processing_error is not null and processed_at is null;

-- ---------------------------------------------------------------------------
-- 5) devices
-- ---------------------------------------------------------------------------
-- This table predates the repo's migration history (it was created by hand in
-- the hosted project), which is why the local stack never had it. It is created
-- here idempotently with the exact shape src/main/device.ts already reads.
--
-- [HARD] Privilege posture, and the whole point of S5's device work:
--   The Electron client ships a committed anon key. If `authenticated` could
--   INSERT or UPDATE this table, the device limit would be a suggestion -- a
--   doctor could insert a third row, or flip a revoked row back to active, with
--   curl. So the client gets SELECT on its own rows and nothing else. Every
--   write goes through the `device` Edge Function under service_role.
create table if not exists public.devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_id    text not null,
  name         text not null default '',
  platform     text not null default '',
  app_version  text not null default '',
  status       text not null default 'active' check (status in ('active', 'revoked')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  unique (user_id, device_id)
);

-- The hosted project already has this table (created by hand), so the CREATE
-- above is a no-op there and any column it is missing would NOT be added.
-- revoked_at is new in S5 and the Edge Function writes it, so add it explicitly.
-- Without this the migration "succeeds" on the hosted project and every revoke
-- then fails at runtime -- exactly the silent breakage this file is meant to
-- prevent.
alter table public.devices
  add column if not exists revoked_at timestamptz;

comment on table public.devices is
  'Registered installations. Written by the `device` Edge Function (service_role) only -- the plan device_limit is enforced there, never in the client.';
comment on column public.devices.device_id is
  'Stable per-installation UUID from electron-store. Not a hardware id.';

create index if not exists devices_user_status_idx on public.devices (user_id, status);

alter table public.devices enable row level security;

revoke all on public.devices from anon, authenticated;
grant select on public.devices to authenticated;
grant select, insert, update, delete on public.devices to service_role;

drop policy if exists devices_select_own on public.devices;
create policy devices_select_own
  on public.devices for select
  to authenticated
  using (user_id = (select auth.uid()));
-- No insert/update/delete policy and no write GRANT: denied twice.
