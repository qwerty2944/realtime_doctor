-- realtime_doctor -- Migration 0002: subscription / billing schema (S1).
--
-- Scope: tables, RLS, GRANTs, the signup trigger and the single plan seed.
-- The entitlement Edge Function (S2), the admin-web payment page (S3) and the
-- PortOne webhook handler (S4) are deliberately NOT part of this migration.
--
-- Product terms (confirmed, see tasks/subscription-plan.md):
--   * one plan, code 'standard'
--   * 70,000 KRW / month + 7,000 KRW VAT  ->  77,000 KRW actually charged
--   * 7 day free trial, no card required
--   * 2 devices per plan
--
-- Conventions follow 0001: uuid pks via gen_random_uuid(), timestamptz
-- everywhere, user_id is the owning clinician (auth.users.id), and the whole
-- file is idempotent -- re-running it is a no-op.
--
-- Threat model that drives the privilege layout below:
--   The Electron client ships a committed anon key (src/main/supabaseClient.ts).
--   Anything the `authenticated` role may write, a doctor may write by hand with
--   curl. So the client gets *read only, own row only, safe columns only*, and
--   every state transition is service_role's job.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  code         text primary key,
  name         text not null,
  price_krw    integer not null,
  vat_krw      integer not null default 0,
  device_limit integer not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

comment on table public.plans is 'Subscription plans. Public pricing data -- readable by anon for the landing page.';
comment on column public.plans.price_krw is 'Monthly price excluding VAT. Displayed as "70,000 KRW (VAT excluded)".';
comment on column public.plans.vat_krw is 'VAT component. price_krw + vat_krw is the amount actually charged through PortOne (amount.total).';
comment on column public.plans.device_limit is 'Maximum simultaneously registered devices (public.devices) for a subscriber on this plan.';

-- Seed. Upsert, not insert: a later price change must be applied by editing this
-- row (or a follow-up migration), and re-running must never fail on a pk clash.
insert into public.plans (code, name, price_krw, vat_krw, device_limit, active)
values ('standard', 'Standard', 70000, 7000, 2, true)
on conflict (code) do update
  set name         = excluded.name,
      price_krw    = excluded.price_krw,
      vat_krw      = excluded.vat_krw,
      device_limit = excluded.device_limit,
      active       = excluded.active;

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
-- One row per clinician. user_id is the primary key: a doctor has exactly one
-- subscription, so there is no way to end up with two conflicting states.
create table if not exists public.subscriptions (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  plan_code            text not null default 'standard' references public.plans (code),
  status               text not null default 'trialing'
                         check (status in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  trial_ends_at        timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  billing_key          text,
  portone_customer_id  text,
  card_brand           text,
  card_last4           text,
  grace_until          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.subscriptions is
  'Billing state, written by service_role only. Clients read public.subscriptions_self, never this table.';
comment on column public.subscriptions.billing_key is
  'SECRET. PortOne billing key -- a reusable charge token. Never exposed to anon/authenticated.';
comment on column public.subscriptions.portone_customer_id is
  'SECRET. PortOne customer identifier. Never exposed to anon/authenticated.';
comment on column public.subscriptions.card_brand is 'Masked display only (e.g. "Shinhan"). Safe to expose.';
comment on column public.subscriptions.card_last4 is 'Masked display only. Safe to expose.';
comment on column public.subscriptions.grace_until is
  'Dunning grace deadline while status = past_due. Access is NOT blocked during grace.';

create index if not exists subscriptions_status_idx on public.subscriptions (status);
-- Used by the daily "active subscription with no upcoming schedule" safety cron (S4).
create index if not exists subscriptions_current_period_end_idx on public.subscriptions (current_period_end);
create index if not exists subscriptions_trial_ends_at_idx on public.subscriptions (trial_ends_at);

-- ---------------------------------------------------------------------------
-- payment_attempts
-- ---------------------------------------------------------------------------
create table if not exists public.payment_attempts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  payment_id      text not null unique,
  scheduled_for   timestamptz,
  attempted_at    timestamptz,
  amount_krw      integer not null,
  status          text not null,
  failure_code    text,
  failure_message text,
  raw_json        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on column public.payment_attempts.payment_id is
  'PortOne paymentId. UNIQUE so a redelivered webhook cannot create a duplicate attempt row.';
comment on column public.payment_attempts.amount_krw is 'Amount actually charged, VAT included (77000 on the standard plan).';

create index if not exists payment_attempts_user_created_idx
  on public.payment_attempts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- webhook_events
-- ---------------------------------------------------------------------------
-- Audit log and the second idempotency layer: the handler inserts the event id
-- first and treats a unique violation as "already processed".
create table if not exists public.webhook_events (
  id                uuid primary key default gen_random_uuid(),
  portone_event_id  text not null unique,
  type              text,
  payload_json      jsonb not null default '{}'::jsonb,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);

create index if not exists webhook_events_unprocessed_idx
  on public.webhook_events (received_at) where processed_at is null;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- Privileges
-- ===========================================================================
-- RLS decides *which rows*; GRANT decides whether the role may touch the table
-- at all. 0001 documents the failure mode of enabling one without the other:
-- it reads as "there is no data" rather than as an error. Both are set here for
-- every table, and the REVOKEs are explicit so the intent survives a future
-- `grant all on all tables in schema public` accident.

-- --- plans: public pricing -------------------------------------------------
alter table public.plans enable row level security;

revoke all on public.plans from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select, insert, update, delete on public.plans to service_role;

drop policy if exists plans_select_public on public.plans;
create policy plans_select_public
  on public.plans for select
  to anon, authenticated
  using (true);
-- No insert/update/delete policy and no write GRANT: writes are service_role only.

-- --- subscriptions: service_role only, no client access whatsoever ---------
-- This is the core of the design. `authenticated` gets *zero* privileges on the
-- base table, so billing_key and portone_customer_id are unreachable at the
-- table level no matter what policies exist. Clients read the view below.
alter table public.subscriptions enable row level security;

revoke all on public.subscriptions from anon, authenticated;
grant select, insert, update, delete on public.subscriptions to service_role;
-- Intentionally NO policy for anon/authenticated. RLS with zero policies denies
-- everything, and the missing GRANT denies it a second time.
-- Intentionally NOT `force row level security`: the table owner must keep its
-- RLS exemption for the security-definer view below to work.

-- --- payment_attempts: owner may read their billing history ----------------
alter table public.payment_attempts enable row level security;

revoke all on public.payment_attempts from anon, authenticated;
grant select on public.payment_attempts to authenticated;
grant select, insert, update, delete on public.payment_attempts to service_role;

drop policy if exists payment_attempts_select_own on public.payment_attempts;
create policy payment_attempts_select_own
  on public.payment_attempts for select
  to authenticated
  using (user_id = (select auth.uid()));
-- raw_json can carry PortOne response detail but no card number and no billing
-- key; it belongs to the user's own payment, so exposing it to the owner is fine.

-- --- webhook_events: service_role only -------------------------------------
alter table public.webhook_events enable row level security;

revoke all on public.webhook_events from anon, authenticated;
grant select, insert, update, delete on public.webhook_events to service_role;
-- No policies for anon/authenticated: clients have no business reading raw
-- provider payloads.

-- ---------------------------------------------------------------------------
-- subscriptions_self -- the only subscription surface a client ever sees
-- ---------------------------------------------------------------------------
-- Why a view rather than a SELECT policy on the table:
--   RLS is row level, not column level. A `for select` policy on
--   public.subscriptions would let the owner run
--   `select billing_key from subscriptions` and get their charge token back.
--
-- This view is a SECURITY DEFINER view (security_invoker = false, the default):
-- it executes with the privileges of its owner, which is also the owner of the
-- base table, and a table owner is exempt from that table's RLS policies unless
-- FORCE ROW LEVEL SECURITY is set -- which is why it is deliberately not set.
-- The row scope is therefore enforced by the view's own WHERE clause, and the
-- column scope by the select list. Neither is reachable from the client:
--   * the client cannot widen the select list -- the columns do not exist on the view
--   * the client cannot drop the WHERE -- `where user_id = <other>` on top of the
--     view is ANDed with it, never replaces it
--   * security_barrier stops a user-supplied VOLATILE function in the outer
--     WHERE from being pushed below the auth.uid() filter and leaking other
--     rows through side effects or error messages
--   * the view has no INSERT/UPDATE/DELETE grant, so it is not a write path
--     even though a single-table view would otherwise be auto-updatable
create or replace view public.subscriptions_self
with (security_barrier = true) as
  select
    s.user_id,
    s.plan_code,
    s.status,
    s.trial_ends_at,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end,
    s.card_brand,
    s.card_last4,
    s.grace_until,
    -- Whether a card is registered, without revealing the token itself.
    (s.billing_key is not null) as has_billing_key,
    s.created_at,
    s.updated_at
  from public.subscriptions s
  where s.user_id = (select auth.uid());

comment on view public.subscriptions_self is
  'Owner-scoped, secret-free projection of public.subscriptions. The client reads this; the base table is service_role only.';

revoke all on public.subscriptions_self from anon, authenticated;
grant select on public.subscriptions_self to authenticated;
grant select on public.subscriptions_self to service_role;

-- ===========================================================================
-- Signup trigger
-- ===========================================================================
-- The trial must be granted by the database, not by the app. An account created
-- through the Supabase auth API directly (or through the dashboard) never
-- touches Electron code, and if the app were responsible for the row that
-- account would have no subscription at all -- which, depending on how the gate
-- fails, is either a lockout or unlimited free access.
create or replace function public.handle_new_user_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.subscriptions (user_id, plan_code, status, trial_ends_at)
  values (new.id, 'standard', 'trialing', now() + interval '7 days')
  on conflict (user_id) do nothing;
  return new;
exception
  when others then
    -- Tradeoff, taken deliberately: signup must not fail because billing state
    -- could not be written. This trigger runs inside GoTrue's signup
    -- transaction, so an unhandled error aborts the whole INSERT and the doctor
    -- simply cannot create an account -- an outage of the billing schema would
    -- become an outage of registration.
    --
    -- The cost is that a user can exist with no subscriptions row. That is safe
    -- only because the entitlement check (S2) is fail-closed: no row means no
    -- entitlement, never "unlimited". A missing row is recoverable (re-run the
    -- backfill below); a blocked signup is not.
    raise warning 'handle_new_user_subscription failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

comment on function public.handle_new_user_subscription() is
  'Creates the 7-day trial subscription on signup. SECURITY DEFINER because GoTrue inserts into auth.users as a role with no rights on public.subscriptions.';

-- SECURITY DEFINER means this function runs with its owner's rights, so lock
-- down who may call it directly.
revoke all on function public.handle_new_user_subscription() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row execute function public.handle_new_user_subscription();

-- ===========================================================================
-- Backfill
-- ===========================================================================
-- Existing accounts predate this schema and have been using the product for
-- free. Two options were considered:
--
--   trialing + 7 days  -- rejected. It silently starts a clock on people who
--     never agreed to one; a week later the owner's own account and every pilot
--     doctor lock out simultaneously, and the first signal is a support ticket.
--
--   active, comped     -- chosen. Existing users keep working exactly as before.
--     They get status='active' with a one-year current_period_end and NO
--     billing_key, so no charge can be attempted (S3/S4 only ever charge rows
--     that have a billing key). They are, in effect, grandfathered for a year,
--     which is a deliberate business decision to be revisited before it lapses
--     rather than an accident that fires on day 8.
--
-- Idempotent: `on conflict do nothing` plus the NOT EXISTS guard means new users
-- created by the trigger after this migration are never rewritten to 'active'.
insert into public.subscriptions
  (user_id, plan_code, status, current_period_start, current_period_end)
select u.id, 'standard', 'active', now(), now() + interval '1 year'
from auth.users u
where not exists (
  select 1 from public.subscriptions s where s.user_id = u.id
)
on conflict (user_id) do nothing;
