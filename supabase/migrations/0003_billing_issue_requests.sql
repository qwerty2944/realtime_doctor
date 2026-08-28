-- realtime_doctor -- Migration 0003: billing key issue requests (S3).
--
-- Scope: the one-time `issueId` that admin-web hands to the PortOne browser SDK.
-- Nothing here relaxes 0002: the table is service_role only, and no policy or
-- GRANT is added to public.subscriptions.
--
-- Why this table exists at all -- it does two jobs:
--
--   1. Binding. The browser gets an issueId and later posts a billingKey back.
--      Without a server-side record the server would have to believe the
--      browser's claim about which issue request the key belongs to.
--
--   2. Idempotency lock. Completion claims the row with a conditional UPDATE
--      (`... where consumed_at is null returning *`). Exactly one concurrent
--      request wins that UPDATE, so a double-submitted form cannot reach the
--      charge call twice. payment_attempts.payment_id (UNIQUE, 0002) is the
--      second layer and PortOne's own paymentId dedupe is the third.

create table if not exists public.billing_issue_requests (
  issue_id     text primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  customer_id  text not null,
  payment_id   text not null,
  created_at   timestamptz not null default now(),
  consumed_at  timestamptz,
  billing_key  text,
  outcome      text
);

comment on table public.billing_issue_requests is
  'One-time PortOne issueId records (S3). Service_role only -- the client never reads or writes this.';
comment on column public.billing_issue_requests.payment_id is
  'Deterministic paymentId for the first charge of this request. Same request => same paymentId => PortOne and payment_attempts both dedupe it.';
comment on column public.billing_issue_requests.consumed_at is
  'Set by the conditional UPDATE that claims the request. Non-null means completion already ran (successfully or not).';
comment on column public.billing_issue_requests.outcome is
  'paid | failed | rejected. Diagnostic only; the authoritative record is payment_attempts.';

create index if not exists billing_issue_requests_user_idx
  on public.billing_issue_requests (user_id, created_at desc);

-- Privileges: same posture as public.subscriptions. RLS on, zero policies for
-- anon/authenticated, and no GRANT either -- denied twice.
alter table public.billing_issue_requests enable row level security;

revoke all on public.billing_issue_requests from anon, authenticated;
grant select, insert, update, delete on public.billing_issue_requests to service_role;
