-- realtime_doctor -- Migration 0017: the observability layer's storage and its
-- database-side self-tests.
--
-- Why this file exists
-- --------------------
-- Nothing in this product tells anyone when it breaks. If the kiosk stops
-- serving, if `entitlement` starts 500ing, if a provider key expires, the first
-- signal is a doctor phoning during a consultation. This file is the storage and
-- the database half of the fix; the HTTP half is doctor-web's `/api/ops/probe`
-- and the four `/api/health` surfaces.
--
-- The principle copied from 0004
-- -----------------------------
-- `subscription_watchdog_runs` (0004:57) writes a row on EVERY run, including
-- the ones that find nothing. "zero problems today" and "the job has not run
-- since March" must not look the same in the database, because in both cases the
-- naive schema (record only failures) is empty. `ops_probe_runs` keeps that
-- property, and adds one the watchdog does not have: an explicit
-- `expected_next_run_at`, so staleness is a comparison against a stored
-- expectation rather than against a threshold somebody has to remember.
--
-- What this file deliberately does NOT do
-- ---------------------------------------
--   * No pg_cron. The prober has to make outbound HTTPS calls to Vercel and to
--     Supabase's function gateway and to a webhook. That is the same argument
--     0004's header makes for the billing watchdog: the database can observe but
--     it cannot act, so the actor lives in the web tier and the database stores.
--   * No provider calls. `f_ops_*` touch only this project's own tables. A
--     health check that burns Gemini quota is a health check nobody can afford
--     to run often, and one that creates PHI is a health check that is itself an
--     incident.
--
-- Naming: `ops_` / `f_ops_`
-- -------------------------
-- Same reasoning as 0014's `web_` / `f_web_`: a prefix that cannot collide with
-- the app's own objects, and a pre-flight below that refuses to run if somebody
-- else already owns the prefix.
--
-- [HARD] Interaction with 0013 and 0014
-- ------------------------------------
-- 0013 rebuilds `public.role_privilege_allowlist` from scratch on every run.
-- This file adds NO rows to that allowlist, because it grants nothing to `anon`
-- or `authenticated` -- every object here is service_role-only. So re-running
-- 0013 cannot break this file, and this file cannot break 0013's guard. The
-- guard is re-run verbatim at the bottom to prove that, on the live catalogue,
-- rather than to assert it in a comment.

-- ===========================================================================
-- 0) Pre-flight: refuse to run if somebody else already owns the `ops_` prefix
-- ===========================================================================
do $$
declare
  v_owned_relations constant text[] := array[
    'ops_probe_runs',
    'ops_probe_alert_state',
    'ops_probe_status'
  ];
  v_owned_functions constant text[] := array[
    'f_ops_stats_probe',
    'f_ops_intake_probe'
  ];
  v_bad text;
begin
  select string_agg(x.line, ', ' order by x.line)
  into v_bad
  from (
    select format('relation public.%s', c.relname) as line
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and c.relname like 'ops\_%'
      and c.relname <> all (v_owned_relations)

    union all

    select format('function public.%s', p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'f\_ops\_%'
      and p.proname <> all (v_owned_functions)
  ) x;

  if v_bad is not null then
    raise exception
      E'public already contains ops-prefixed objects this migration does not own: %\nRefusing to run: the prefix is meant to be collision-free and is not.',
      v_bad;
  end if;
end;
$$;

-- ===========================================================================
-- 1) ops_probe_runs -- one row per prober execution, all-clear included
-- ===========================================================================
create table if not exists public.ops_probe_runs (
  id                     uuid primary key default gen_random_uuid(),
  started_at             timestamptz not null default now(),
  finished_at            timestamptz,

  -- 'ok'       -- every surface answered and every check inside it passed.
  -- 'degraded' -- at least one surface answered but one of its checks failed,
  --               or an alert could not be delivered. The product still works
  --               for somebody.
  -- 'down'     -- at least one surface did not answer at all.
  -- 'error'    -- the prober itself threw. Distinct from 'down' on purpose: a
  --               broken check and a broken product need different people.
  status                 text not null default 'error'
                           check (status in ('ok', 'degraded', 'down', 'error')),

  surface_count          integer not null default 0,
  ok_count               integer not null default 0,
  degraded_count         integer not null default 0,
  down_count             integer not null default 0,

  -- Per-surface results. Shape:
  --   [{surface, url, status, httpStatus, latencyMs, checks:[{name, ok, detail}],
  --     issue, detail}]
  -- Never contains a credential, a patient identifier or a response body.
  details                jsonb not null default '[]'::jsonb,

  -- ── The dead-man's switch ────────────────────────────────────────────────
  -- Written by the prober from its own schedule at the moment it runs. A reader
  -- (the /api/health endpoints, the status view below, a human) compares now()
  -- against the newest row's expectation and can therefore say "this job is
  -- late" without knowing the cron expression. Storing the expectation instead
  -- of hard-coding the threshold in every reader is what stops the threshold
  -- from drifting away from the schedule the day somebody edits vercel.json.
  expected_next_run_at   timestamptz,

  -- Gap in seconds between this run's start and the previous run's start, as
  -- measured by the prober. Populated even on the first run (null there).
  -- A gap much larger than the schedule is the fingerprint of a silent stop
  -- that has since recovered -- the only kind of self-death a job CAN detect
  -- from the inside, and the reason it is recorded rather than inferred later.
  gap_seconds            integer,
  -- True when `gap_seconds` exceeded the previous row's `expected_next_run_at`
  -- by the prober's tolerance. Means: this job was not running for a while and
  -- nobody was told.
  missed_previous_run    boolean not null default false,

  -- ── Alerting ─────────────────────────────────────────────────────────────
  -- [HARD] Recorded on every run, not only when something fires. A notifier
  -- with no target that says nothing is exactly the failure this whole feature
  -- exists to prevent, so "there was nowhere to send it" is a stored fact.
  alert_target_configured boolean not null default false,
  alerts_sent             integer not null default 0,
  alerts_suppressed       integer not null default 0,
  alerts_undeliverable    integer not null default 0,
  alert_error             text,

  error                  text
);

comment on table public.ops_probe_runs is
  'One row per observability prober execution, written even when every surface is healthy. Copies subscription_watchdog_runs (0004): a silent zero must be distinguishable from a job that stopped running. Adds expected_next_run_at so staleness is measured against a stored expectation rather than a remembered threshold.';
comment on column public.ops_probe_runs.status is
  'ok | degraded | down | error. "error" means the prober itself failed, which is a different incident from the product being down.';
comment on column public.ops_probe_runs.details is
  'Per-surface results. Contains no credential, no response body and no patient identifier.';
comment on column public.ops_probe_runs.expected_next_run_at is
  'When the next run is due, written by the prober from its own schedule. Readers compare now() against the newest row rather than hard-coding a threshold.';
comment on column public.ops_probe_runs.missed_previous_run is
  'True when the gap since the previous run exceeded its expectation. The only form of self-death a scheduled job can detect from the inside: it can report the outage after it ends, never during.';
comment on column public.ops_probe_runs.alert_target_configured is
  'False when OPS_ALERT_WEBHOOK_URL is unset. Stored per run so "alerts are going nowhere" is a queryable fact and not an absence.';

create index if not exists ops_probe_runs_started_idx
  on public.ops_probe_runs (started_at desc);

alter table public.ops_probe_runs enable row level security;

-- Denied twice: no GRANT and no policy. The blanket revoke names anon and
-- authenticated explicitly rather than relying on `from public`, which is the
-- whole subject of 0013's header -- Supabase's default privileges write NAMED
-- grantee entries that `revoke ... from public` cannot remove.
revoke all on public.ops_probe_runs from public, anon, authenticated;
grant select, insert, update, delete on public.ops_probe_runs to service_role;

-- ===========================================================================
-- 2) ops_probe_alert_state -- deduplication ledger
-- ===========================================================================
-- Without this, one broken surface emits an alert on every run. At a 5-minute
-- schedule that is 288 messages a day about a single fact, which trains whoever
-- receives them to ignore the channel -- and the channel is the entire point.
--
-- Keyed on (surface, issue) rather than on the whole finding: the detail text
-- carries a latency or an error string that changes between runs, and keying on
-- something that changes is the same as not deduplicating.
create table if not exists public.ops_probe_alert_state (
  surface          text not null,
  issue            text not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_alerted_at  timestamptz,
  alert_count      integer not null default 0,
  -- Consecutive failing runs. A surface that flaps once is not worth waking
  -- somebody for; the prober's own threshold decides, this column supplies it.
  streak           integer not null default 0,
  -- Set when the surface came back. The row is kept rather than deleted so the
  -- recovery notice can be sent once and so the history stays readable.
  resolved_at      timestamptz,
  last_detail      text,
  primary key (surface, issue)
);

comment on table public.ops_probe_alert_state is
  'Per (surface, issue) alert deduplication. Stops one broken surface from emitting an alert on every run, which is how an alert channel becomes noise and then becomes ignored.';
comment on column public.ops_probe_alert_state.streak is
  'Consecutive failing runs for this (surface, issue). The prober alerts only once the streak reaches its threshold, so a single flap is recorded but not announced.';
comment on column public.ops_probe_alert_state.resolved_at is
  'Set when the surface recovered. Rows are kept, not deleted: the recovery notice needs a place to be marked as sent, and the history is worth reading.';

create index if not exists ops_probe_alert_state_unresolved_idx
  on public.ops_probe_alert_state (last_seen_at desc)
  where resolved_at is null;

alter table public.ops_probe_alert_state enable row level security;
revoke all on public.ops_probe_alert_state from public, anon, authenticated;
grant select, insert, update, delete on public.ops_probe_alert_state to service_role;

-- ===========================================================================
-- 3) ops_probe_status -- the one thing a human should read
-- ===========================================================================
-- admin-web is not deployed yet, so for now this view IS the status page. It is
-- written to answer, in one row, the three questions that matter:
--
--   1. Is the product healthy right now?          -> status, down_count
--   2. Is the *prober* healthy?                   -> prober_stale, seconds_late
--   3. If something is wrong, is anyone told?     -> alert_target_configured
--
-- [HARD] `prober_stale` is computed here rather than by each reader. A staleness
-- threshold duplicated across the view, two health endpoints and a future admin
-- screen is four copies that will disagree, and the day they disagree is the day
-- one of them says everything is fine.
create or replace view public.ops_probe_status
with (security_invoker = true)
as
select
  r.id                      as run_id,
  r.started_at,
  r.finished_at,
  r.status,
  r.surface_count,
  r.ok_count,
  r.degraded_count,
  r.down_count,
  r.details,
  r.expected_next_run_at,
  r.missed_previous_run,
  r.alert_target_configured,
  r.alerts_sent,
  r.alerts_suppressed,
  r.alerts_undeliverable,
  r.alert_error,
  r.error,
  -- Age of the newest run. If this grows without bound the prober is dead, and
  -- that is visible from this column alone with no other knowledge.
  extract(epoch from (now() - r.started_at))::bigint as age_seconds,
  -- How late the next run is. Negative means not due yet.
  case
    when r.expected_next_run_at is null then null
    else extract(epoch from (now() - r.expected_next_run_at))::bigint
  end as seconds_late,
  -- The prober is considered dead once it is a full expected interval late on
  -- top of its due time. One missed tick is a cold start or a deploy; two is a
  -- job that stopped.
  coalesce(
    r.expected_next_run_at is not null
      and now() > r.expected_next_run_at
                  + (r.expected_next_run_at - r.started_at),
    true
  ) as prober_stale,
  (
    select count(*)
    from public.ops_probe_alert_state s
    where s.resolved_at is null
  ) as open_issue_count
from public.ops_probe_runs r
order by r.started_at desc
limit 1;

comment on view public.ops_probe_status is
  'The current observability picture in one row: newest prober run, how stale the prober itself is, and whether alerts have anywhere to go. This is the status page until admin-web ships. security_invoker so it cannot become a way around the base table grants.';

revoke all on public.ops_probe_status from public, anon, authenticated;
grant select on public.ops_probe_status to service_role;

-- ===========================================================================
-- 4) f_ops_stats_probe -- exercise the statistics path for real
-- ===========================================================================
-- The problem this solves
-- -----------------------
-- doctor-web's only feature is `/righthand/doctor/statistics`, and everything on
-- that screen comes from the four `f_web_stats_*` functions. A health check that
-- proves "Postgres accepted a connection" proves nothing about that screen: the
-- functions are SECURITY DEFINER over `encounters` and `intake_results`, and any
-- of a dropped column, a renamed table or a revoked privilege breaks them while
-- leaving `select 1` perfectly healthy.
--
-- Calling them directly from the web tier does not work either. They are granted
-- to `authenticated` only, and their first statement raises 42501 when
-- `auth.uid()` is null -- which it always is for a service-role caller. So a
-- direct call from a health endpoint can only ever prove the wall is up, not
-- that the function behind it runs.
--
-- What this does instead
-- ----------------------
-- Sets `request.jwt.claims` to a synthetic subject for the duration of the
-- call, so `auth.uid()` returns a uuid and each function executes its REAL body
-- against the REAL tables, with its real plan. The SQL is not copied here; there
-- is exactly one implementation of each aggregate and this calls it.
--
-- [HARD] What this proves and what it does not
--   PROVES: the four functions exist, compile, are executable, their column
--           shapes are intact, and their queries plan and run against the live
--           `encounters` + `intake_results`.
--   DOES NOT PROVE: that the numbers are correct. The synthetic subject owns no
--           rows, so every aggregate returns zero/empty by construction. A
--           function that silently returned the wrong figures for a real doctor
--           would pass this check.
--   DOES NOT PROVE: that a signed-in doctor's browser session, cookie refresh
--           and `authenticated` grant work. Those live above this layer and are
--           checked by the HTTP surface, not here.
--
-- No PHI can escape: the synthetic subject is a fixed uuid that belongs to
-- nobody, so the aggregates are empty, and only row counts are returned.
create or replace function public.f_ops_stats_probe()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  -- A fixed, documented, never-issued subject. Fixed rather than random so a
  -- reader of pg_stat_statements or the audit trail can recognise the probe
  -- instead of investigating an unknown uuid.
  v_probe_subject constant uuid := '00000000-0000-4000-8000-0000000b0000';
  v_prev            text;
  v_from            date := (now() at time zone 'UTC')::date - 7;
  v_to              date := (now() at time zone 'UTC')::date;
  v_summary_rows    integer := 0;
  v_daily_rows      integer := 0;
  v_diagnosis_rows  integer := 0;
  v_complaint_rows  integer := 0;
  v_encounters_ok   boolean := false;
  v_failed          text;
begin
  -- Save whatever PostgREST put there for this request and put it back, so the
  -- probe cannot leak its synthetic identity into anything else that runs in
  -- the same transaction.
  v_prev := coalesce(current_setting('request.jwt.claims', true), '');
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', v_probe_subject::text, 'role', 'authenticated')::text,
    true
  );
  -- auth.uid() prefers `request.jwt.claim.sub` over `request.jwt.claims`, so
  -- the singular form has to be cleared or it wins and the probe silently runs
  -- as somebody else. This is exactly the sort of ordering that a comment-free
  -- version of this function would get wrong once and never notice.
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    select count(*) into v_summary_rows
    from public.f_web_stats_summary(v_from, v_to);

    select count(*) into v_daily_rows
    from public.f_web_stats_daily(v_from, v_to);

    select count(*) into v_diagnosis_rows
    from public.f_web_stats_diagnosis(v_from, v_to);

    select count(*) into v_complaint_rows
    from public.f_web_stats_chief_complaint(v_from, v_to);

    -- Reachability of the underlying table, separately from the functions over
    -- it. Distinguishes "the aggregate is broken" from "the table is gone".
    perform 1 from public.encounters limit 1;
    v_encounters_ok := true;
  exception when others then
    v_failed := sqlstate || ' ' || sqlerrm;
  end;

  perform set_config('request.jwt.claims', v_prev, true);

  if v_failed is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'stats_rpc_failed',
      'detail', v_failed
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'summaryRows', v_summary_rows,
    'dailyRows', v_daily_rows,
    'diagnosisRows', v_diagnosis_rows,
    'chiefComplaintRows', v_complaint_rows,
    'encountersReachable', v_encounters_ok,
    -- Stated in the payload, not only in this comment, so the operator reading
    -- a health response is told the limit of what they are looking at.
    'note', 'Executed with a synthetic subject that owns no rows: proves the four f_web_stats_* functions run against the live tables, not that their numbers are right.'
  );
end;
$$;

comment on function public.f_ops_stats_probe() is
  'Health probe for the statistics path. Runs the four real f_web_stats_* functions under a synthetic auth subject so their bodies execute against the live tables. Returns row counts only. service_role only.';

revoke all on function public.f_ops_stats_probe() from public, anon, authenticated;
grant execute on function public.f_ops_stats_probe() to service_role;

-- ===========================================================================
-- 5) f_ops_intake_probe -- exercise the kiosk's entry path without consuming it
-- ===========================================================================
-- What starting an intake actually needs
-- --------------------------------------
-- A patient reaches the kiosk with a visit code. Before anything else,
-- `redeem_visit_access_code()` decides whether that code opens a consultation.
-- If that function is broken, no patient can start an intake, and every other
-- part of the kiosk will look perfectly healthy while it happens.
--
-- Why this cannot simply call it
-- -----------------------------
-- Every failure path inside `redeem_visit_access_code` calls
-- `record_visit_code_failure`, deliberately WITHOUT raising, precisely so the
-- counter survives (0009's header: "a rate limiter that unwinds with the
-- attacker is not a rate limiter"). A probe that fed it a wrong code every few
-- minutes would eat the clinic's real brute-force budget, and at a fast enough
-- schedule would rate-limit actual patients. That is a health check causing the
-- outage it is watching for.
--
-- How this avoids it
-- ------------------
-- The call runs inside a plpgsql BEGIN/EXCEPTION block, which is a real
-- subtransaction. Raising at the end of the block rolls the subtransaction back,
-- taking the failure-counter row with it. plpgsql variables are process memory
-- and are NOT rolled back, so the verdict survives the rollback that erases its
-- side effects. Nothing is created, nothing is consumed, and the returned
-- before/after counter readings prove that rather than assert it.
--
-- [HARD] What this proves and what it does not
--   PROVES: the clinician this kiosk is bound to exists; `redeem_visit_access_code`
--           exists and runs; normalisation, the rate-limit read and the code
--           lookup against `visit_access_codes` all execute; the failure counter
--           is untouched by the probe.
--   DOES NOT PROVE: that a VALID code succeeds. Proving that needs a real
--           issued code, and issuing one creates a real `encounters` row, i.e.
--           PHI. The negative path shares every line of the positive path up to
--           the match, which is where the check deliberately stops.
--   DOES NOT PROVE: anything about Gemini, CLOVA or the interview loop. Those
--           are provider-metered and are checked only for configuration
--           presence, in the kiosk's HTTP health route.
create or replace function public.f_ops_intake_probe(
  p_clinician_id uuid,
  p_kiosk_slug text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_bucket        timestamptz := date_trunc('minute', now());
  v_before        integer;
  v_after         integer;
  v_code          text;
  v_alphabet      text;
  v_len           integer;
  v_verdict       jsonb;
  v_failed        text;
  i               integer;
begin
  if p_clinician_id is null then
    return jsonb_build_object('ok', false, 'reason', 'clinician_not_configured');
  end if;

  -- Checked explicitly instead of letting the foreign key on
  -- `visit_access_code_attempts` blow up inside the probe: a misconfigured
  -- KIOSK_CLINICIANS uuid is a real and likely fault, and it deserves its own
  -- name rather than surfacing as an opaque constraint violation.
  if not exists (select 1 from auth.users u where u.id = p_clinician_id) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'clinician_unknown',
      'detail', 'KIOSK_CLINICIANS names an auth user that does not exist; every intake from this kiosk would be invisible to every doctor.'
    );
  end if;

  select failures into v_before
  from public.visit_access_code_attempts
  where user_id = p_clinician_id and minute_bucket = v_bucket;
  v_before := coalesce(v_before, 0);

  -- A syntactically valid code of the correct length, so the call goes past the
  -- length guard and reaches the real hash-and-match lookup. Drawn from the
  -- product's own alphabet function rather than a literal, so the probe cannot
  -- drift away from the keyspace it is exercising.
  v_alphabet := public.visit_code_alphabet();
  v_len := public.visit_code_length();
  v_code := '';
  for i in 1 .. v_len loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;

  -- Subtransaction. Everything the call writes dies with the raise below.
  begin
    v_verdict := public.redeem_visit_access_code(
      p_clinician_id,
      v_code,
      p_kiosk_slug,
      false  -- check only: no consume, no encounter, no PHI
    );
    raise exception 'ops_probe_rollback' using errcode = 'P0001';
  exception
    when others then
      if sqlerrm <> 'ops_probe_rollback' then
        v_failed := sqlstate || ' ' || sqlerrm;
      end if;
  end;

  if v_failed is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'redeem_rpc_failed',
      'detail', v_failed
    );
  end if;

  select failures into v_after
  from public.visit_access_code_attempts
  where user_id = p_clinician_id and minute_bucket = v_bucket;
  v_after := coalesce(v_after, 0);

  return jsonb_build_object(
    -- The expected verdict for a code that was never issued. `ok:true` here
    -- means "the gate answered correctly", not "the code worked".
    'ok', (v_verdict ->> 'ok') = 'false' and (v_verdict ->> 'reason') = 'unknown',
    'verdict', v_verdict ->> 'reason',
    'rateLimitBefore', v_before,
    'rateLimitAfter', v_after,
    -- [HARD] If these two ever differ, the rollback stopped working and the
    -- probe is now eating the clinic's brute-force budget. Surfaced as a value
    -- so it is caught by the check rather than by a patient being refused.
    'consumedNothing', v_before = v_after,
    'note', 'Negative path only, rolled back. Proves the redemption gate runs and stays untouched; does not prove a valid code succeeds (that would create an encounter).'
  );
end;
$$;

comment on function public.f_ops_intake_probe(uuid, text) is
  'Health probe for the kiosk intake entry path. Calls the real redeem_visit_access_code in check-only mode inside a rolled-back subtransaction, so the brute-force counter is not consumed. Creates nothing. service_role only.';

revoke all on function public.f_ops_intake_probe(uuid, text) from public, anon, authenticated;
grant execute on function public.f_ops_intake_probe(uuid, text) to service_role;

-- ===========================================================================
-- 6) The guard -- 0013's predicate, re-run against the live catalogue
-- ===========================================================================
-- Verbatim from 0013 section 5. It is repeated rather than referenced because
-- the claim this file needs to make is not "0013 was correct when it ran", it is
-- "the catalogue is still clean AFTER this file ran". Only re-executing it
-- against the catalogue can say that, and this file adds five objects that
-- Supabase's default privileges would happily have handed to `anon`.
do $$
declare
  v_bad text;
begin
  select string_agg(x.line, E'\n  ' order by x.line)
  into v_bad
  from (
    select format('function %s -> PUBLIC EXECUTE', p.oid::regprocedure::text) as line
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) e where e.grantee = 0))

    union all

    select format('function %s -> %s %s', p.oid::regprocedure::text, a.role, a.priv)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral (
      select pg_get_userbyid(e.grantee) as role, e.privilege_type as priv
      from aclexplode(p.proacl) e
      where e.grantee <> 0
    ) a
    where n.nspname = 'public'
      and a.role in ('anon', 'authenticated')
      and not exists (
        select 1 from public.role_privilege_allowlist w
        where w.object_kind = 'function'
          and to_regprocedure(w.object_name) = p.oid
          and w.grantee = a.role
          and w.privilege = a.priv
      )

    union all

    select format('relation %s -> PUBLIC %s', c.oid::regclass::text, e.privilege_type)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) e
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and e.grantee = 0

    union all

    select format('relation %s -> %s %s', c.oid::regclass::text, a.role, a.priv)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      select pg_get_userbyid(e.grantee) as role, e.privilege_type as priv
      from aclexplode(c.relacl) e
      where e.grantee <> 0
    ) a
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and a.role in ('anon', 'authenticated')
      and not exists (
        select 1 from public.role_privilege_allowlist w
        where w.object_kind = 'relation'
          and to_regclass(w.object_name) = c.oid
          and w.grantee = a.role
          and w.privilege = a.priv
      )
  ) x;

  if v_bad is not null then
    raise exception E'public schema grants privileges to anon/authenticated/PUBLIC outside public.role_privilege_allowlist:\n  %', v_bad;
  end if;
end;
$$;

-- Self-check: the three new relations and two new functions must be reachable by
-- service_role and by nobody else. Asserted here so a future edit that drops a
-- grant fails the migration instead of failing the prober at 03:00.
do $$
declare
  v_missing text;
begin
  select string_agg(x.what, ', ' order by x.what)
  into v_missing
  from (
    select 'relation ' || r as what
    from unnest(array['public.ops_probe_runs', 'public.ops_probe_alert_state', 'public.ops_probe_status']) as r
    where not has_table_privilege('service_role', r, 'SELECT')

    union all

    select 'function ' || f as what
    from unnest(array['public.f_ops_stats_probe()', 'public.f_ops_intake_probe(uuid, text)']) as f
    where not has_function_privilege('service_role', f, 'EXECUTE')
  ) x;

  if v_missing is not null then
    raise exception 'service_role cannot reach objects 0017 created: %', v_missing;
  end if;
end;
$$;
