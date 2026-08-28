-- realtime_doctor -- Migration 0014: the web statistics screen.
--
-- Scope
-- -----
-- The web (righthand_voice) is now ONE screen: `/righthand/doctor/statistics`.
-- Patient intake moved to `kiosk/`; the waiting list, consultation and recording
-- live in the Electron app. So this file adds only what a read-only statistics
-- screen needs:
--
--   * four reporting functions over the app's own `encounters` + `intake_results`
--   * one small table so the CSV export leaves a trail
--
-- No web-owned copy of `patients`, `encounters`, `intake_results`, `messages`,
-- `doctors`, `red_flags` or `test_master` is created. An earlier draft of this
-- migration (`0014_web_intake_and_stats.sql`) created six such tables for a web
-- intake flow that has since been deleted; it is replaced by this file.
--
-- Naming: `web_` / `f_web_`
-- -------------------------
-- `sessions`, `patients`, `intake_results`, `evidence_lookups` and `profiles`
-- already exist in this project with DIFFERENT meanings from the ones the web
-- code was written against, and `f_stats_*` was the web's own name for functions
-- over its now-deleted schema. Everything this file creates is prefixed so a
-- collision is impossible by construction.
--
-- A separate `web` schema was considered and rejected twice over:
--   1. PostgREST only serves schemas listed in the project's *exposed schemas*
--      setting. That is API configuration, not SQL, so a `web` schema would be
--      invisible to supabase-js until somebody changed a dashboard field — a
--      dependency this migration could neither express nor verify.
--   2. `0013`'s privilege guard audits `public` and nothing else. Objects outside
--      `public` escape it, and escaping the audit is not a safety property.
--
-- Additive and idempotent only
-- ----------------------------
-- No ALTER, no DROP, no UPDATE, no DELETE against any app-owned object. The only
-- reach into app territory is (a) reading `encounters` / `intake_results` inside
-- the functions and (b) one foreign key FROM the new audit table TO `auth.users`.
-- Re-running the file is a no-op.
--
-- [HARD] Interaction with 0013
-- ----------------------------
-- `0013` rebuilds `public.role_privilege_allowlist` from scratch on every run
-- (`delete from public.role_privilege_allowlist`, 0013:101). **Re-applying 0013
-- after this file deletes the four rows below, and 0013's own guard will then
-- fail on the four function grants this file left standing.** If 0013 is ever
-- re-run, re-run this file immediately afterwards.

-- ===========================================================================
-- 0) Pre-flight: refuse to run if somebody else already owns a `web_%` object
-- ===========================================================================
-- Half-applying onto a name we do not own is how a schema collision on a
-- production clinical database starts. Abort instead.
do $$
declare
  v_owned_relations constant text[] := array[
    'web_stats_export_audit',
    -- Created by 0015, not by this file. Listed here because this pre-flight
    -- aborts on any `web_%` relation it does not recognise, and a later
    -- migration in the same history is not the "somebody else" it guards
    -- against -- without this entry, re-running 0014 after 0015 aborts.
    'web_app_download_audit'
  ];
  v_owned_functions constant text[] := array[
    'f_web_stats_summary',
    'f_web_stats_daily',
    'f_web_stats_diagnosis',
    'f_web_stats_chief_complaint'
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
      and c.relname like 'web\_%'
      and c.relname <> all (v_owned_relations)

    union all

    select format('function public.%s', p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'f\_web\_%'
      and p.proname <> all (v_owned_functions)
  ) x;

  if v_bad is not null then
    raise exception
      E'public already contains web-prefixed objects this migration does not own: %\nRefusing to run: the prefix is meant to be collision-free and is not.',
      v_bad;
  end if;
end;
$$;

-- ===========================================================================
-- 1) web_stats_export_audit -- who pulled clinic-wide numbers, when
-- ===========================================================================
-- The CSV itself is built in the browser from data it already holds, so the
-- export moves no data. It is still recorded: the aggregates are de-identified,
-- but "who pulled clinic-wide numbers, when, and for which period" is exactly
-- the question an audit log is asked after the fact.
--
-- This is the one new table in the file, and it exists because the web code
-- withholds the download when the audit write fails
-- (src/app/righthand/doctor/(app)/statistics/StatisticsView.tsx:137). Without a
-- table the export is not degraded, it is broken.
--
-- It carries no PHI: a user id, two calendar dates, a row count.
create table if not exists public.web_stats_export_audit (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  period_from date not null,
  period_to   date not null,
  row_count   integer not null check (row_count >= 0),
  created_at  timestamptz not null default now()
);

comment on table public.web_stats_export_audit is
  'One row per statistics CSV export from the web dashboard. No PHI: user id, period bounds, row count. Written only by the web server on service_role; anon and authenticated hold nothing, so a client can neither suppress nor forge an entry.';

create index if not exists web_stats_export_audit_user_idx
  on public.web_stats_export_audit (user_id, created_at desc);

-- service_role only. An audit row the audited party can write or edit is not an
-- audit row, so there is deliberately no grant for `authenticated` here and
-- therefore no allowlist entry for this table below.
revoke all on public.web_stats_export_audit from anon, authenticated;
grant select, insert on public.web_stats_export_audit to service_role;

alter table public.web_stats_export_audit enable row level security;
-- No policy for any client role: denied twice (no GRANT, no policy).

-- ===========================================================================
-- 2) Reporting functions
-- ===========================================================================
-- Shape of the data
-- -----------------
--   session_count      -> encounter_count. The web's `sessions` is this
--                         project's `encounters` (0001: "Named encounters rather
--                         than sessions because this app already has a sessions
--                         table meaning a recording session").
--   intake_results.session_id -> intake_results.encounter_id.
--   "latest interpretation" -> the row with `superseded_at is null`. 0011
--                         replaced the web's `unique(session_id, version)` +
--                         highest-version rule with explicit supersession, and
--                         created `intake_results_current_idx on (encounter_id,
--                         version desc) where superseded_at is null` for exactly
--                         this predicate. `order by version desc limit 1` inside
--                         the lateral keeps it single-valued even if two live
--                         rows ever coexist.
--
-- avg_duration_seconds
-- --------------------
-- `encounters.created_at` -> the FIRST `intake_results.created_at` for that
-- encounter. This is sound, and no `web_messages` table is needed:
--   * The encounter row is inserted when the patient starts
--     (kiosk/app/api/intake/start/route.ts:142, status 'intake_in_progress').
--   * The first intake_results row is inserted the moment the interview ends,
--     immediately before the encounter is moved to 'intake_done'
--     (kiosk/lib/intake/result.ts:216-251). The two writes are in the same
--     function with nothing between them but an error check.
-- So the difference is the wall-clock length of the interview.
--
-- `min(created_at)`, not the latest row's: a 0011 re-derivation inserts a NEW
-- row days or months later, and using it would report the age of the record
-- instead of the length of the interview.
--
-- The conversation itself lives in `intake_results.soap_json.transcript`
-- (kiosk/lib/intake/interview.ts:20) rather than in a messages table — that is a
-- deliberate choice of the kiosk's, and it is why the web's old
-- `max(messages.ts) - sessions.created_at` has no equivalent here and no table
-- is invented to give it one.
--
-- Encounters with no intake result contribute null; `avg()` ignores nulls, so
-- they neither raise nor lower the average, and `measured_encounters` says how
-- many actually contributed.
--
-- confirmed_count: REMOVED
-- ------------------------
-- The web's source was `consult_records.final_diagnosis`. Nothing equivalent
-- exists in this project, and its absence is deliberate rather than an oversight:
--   * `summaries.clinical_impression` (0000:231) is written from LLM output
--     (src/main/sessions.ts:660) and is not a clinician's confirmation.
--   * `dictations.sections` is generated documentation, same objection.
--   * `clinical_decision_events` (0012) refuses the concept outright — its
--     header, marked [HARD]: "No 'adopted' / 'overrode' / 'ignored' flag. The app
--     never learns the clinician's own diagnosis, so any such label would be
--     inferred."
-- A tile reading a permanent zero is a worse answer than no tile, so the metric
-- is gone from the dashboard and from the CSV as well as from here.
--
-- SECURITY DEFINER + auth.uid()
-- -----------------------------
-- [HARD] These run as the owner, so RLS on `encounters` does NOT apply and the
-- `e.user_id = v_uid` predicate is the ONLY thing keeping one clinician's numbers
-- away from another. Do not remove it, and do not add a code path that reaches
-- these tables without it. The null check is not decoration either: `auth.uid()`
-- is null for an unauthenticated caller, and `e.user_id = null` is null, not
-- false — the predicate would drop every row rather than raising, which is safe
-- here but silently so. Raising is better than being accidentally safe.
--
-- De-identification: no function returns a patient name, birth date,
-- registration number, phone, patient id or encounter id.

create or replace function public.f_web_stats_daily(p_from date, p_to date)
returns table (day date, encounter_count bigint, red_flag_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return query
  select
    (e.created_at at time zone 'Asia/Seoul')::date as day,
    count(*)                                       as encounter_count,
    count(*) filter (where e.red_flag)             as red_flag_count
  from public.encounters e
  where e.user_id = v_uid
    and e.status <> 'intake_in_progress'
    and (e.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by 1
  order by 1;
end;
$$;

comment on function public.f_web_stats_daily(date, date) is
  'Web statistics: completed-intake counts per day for the CALLING clinician, over an inclusive Asia/Seoul date range. SECURITY DEFINER; scoped by auth.uid() inside.';

create or replace function public.f_web_stats_diagnosis(p_from date, p_to date)
returns table (diagnosis text, encounter_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return query
  select
    coalesce(
      nullif(btrim(cur.differentials_json -> 0 ->> 'name_kr'), ''),
      nullif(btrim(cur.differentials_json -> 0 ->> 'name_en'), ''),
      '미분류'
    ) as diagnosis,
    count(*) as encounter_count
  from public.encounters e
  left join lateral (
    select r.differentials_json
    from public.intake_results r
    where r.encounter_id = e.id
      and r.superseded_at is null
    order by r.version desc
    limit 1
  ) cur on true
  where e.user_id = v_uid
    and e.status <> 'intake_in_progress'
    and (e.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by 1
  order by encounter_count desc, diagnosis;
end;
$$;

comment on function public.f_web_stats_diagnosis(date, date) is
  'Web statistics: distribution of the top-ranked AI differential from the current (non-superseded) interpretation. There is no clinician-confirmed diagnosis in this schema, so none is preferred over it.';

create or replace function public.f_web_stats_chief_complaint(p_from date, p_to date)
returns table (chief_complaint text, encounter_count bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return query
  -- `encounters.chief_complaint` is denormalised from the latest intake result
  -- by the kiosk (0001:63, written at kiosk/lib/intake/result.ts:250), so no
  -- join is needed. Falling back to the interpretation would re-read a column
  -- that is by construction a copy of it.
  select
    coalesce(nullif(btrim(e.chief_complaint), ''), '미기재') as chief_complaint,
    count(*)                                                as encounter_count
  from public.encounters e
  where e.user_id = v_uid
    and e.status <> 'intake_in_progress'
    and (e.created_at at time zone 'Asia/Seoul')::date between p_from and p_to
  group by 1
  order by encounter_count desc, chief_complaint;
end;
$$;

comment on function public.f_web_stats_chief_complaint(date, date) is
  'Web statistics: chief complaint distribution for the calling clinician, from the denormalised encounters.chief_complaint column.';

create or replace function public.f_web_stats_summary(p_from date, p_to date)
returns table (
  encounter_count      bigint,
  red_flag_count       bigint,
  avg_duration_seconds int,
  measured_encounters  bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  return query
  select
    count(*)                                          as encounter_count,
    count(*) filter (where e.red_flag)                as red_flag_count,
    coalesce(round(avg(dur.duration_seconds)), 0)::int as avg_duration_seconds,
    count(dur.duration_seconds)                       as measured_encounters
  from public.encounters e
  left join lateral (
    -- FIRST interpretation, not the current one: a 0011 re-derivation would
    -- otherwise report the age of the record instead of the interview length.
    select extract(epoch from (min(r.created_at) - e.created_at)) as duration_seconds
    from public.intake_results r
    where r.encounter_id = e.id
    having min(r.created_at) > e.created_at
  ) dur on true
  where e.user_id = v_uid
    and e.status <> 'intake_in_progress'
    and (e.created_at at time zone 'Asia/Seoul')::date between p_from and p_to;
end;
$$;

comment on function public.f_web_stats_summary(date, date) is
  'Web statistics summary tiles. avg_duration_seconds = first intake_results.created_at - encounters.created_at, which is the wall-clock length of the kiosk interview (the two writes bracket it). Encounters with no result contribute null and are counted separately as measured_encounters.';

-- ===========================================================================
-- 3) Privileges
-- ===========================================================================
-- Blanket revoke first, then grant exactly what the allowlist below justifies —
-- the shape 0013 established, and for the reason 0013 documents: Supabase's
-- default privileges put NAMED grantee entries (`anon=X/postgres`) into every new
-- function's ACL, and `revoke ... from public` does not remove them.
revoke all on function public.f_web_stats_daily(date, date)           from public, anon, authenticated;
revoke all on function public.f_web_stats_diagnosis(date, date)       from public, anon, authenticated;
revoke all on function public.f_web_stats_chief_complaint(date, date) from public, anon, authenticated;
revoke all on function public.f_web_stats_summary(date, date)         from public, anon, authenticated;

grant execute on function public.f_web_stats_daily(date, date)           to authenticated;
grant execute on function public.f_web_stats_diagnosis(date, date)       to authenticated;
grant execute on function public.f_web_stats_chief_complaint(date, date) to authenticated;
grant execute on function public.f_web_stats_summary(date, date)         to authenticated;

-- ---------------------------------------------------------------------------
-- Allowlist rows, one per grant introduced above
-- ---------------------------------------------------------------------------
-- Without these, 0013's guard fails the next time it runs and reports these four
-- functions as holes. Deleted by key first so a re-run cannot leave a stale
-- rationale behind.
--
-- Every rationale names a real call site. The four RPCs are issued from one
-- place: `loadStatistics` in the web repo, on the cookie-backed Supabase client
-- (`createSupabaseServerClient`), which acts as `authenticated`.
delete from public.role_privilege_allowlist
where object_kind = 'function'
  and object_name in (
    'public.f_web_stats_daily(date,date)',
    'public.f_web_stats_diagnosis(date,date)',
    'public.f_web_stats_chief_complaint(date,date)',
    'public.f_web_stats_summary(date,date)'
  );

insert into public.role_privilege_allowlist
  (object_kind, object_name, grantee, privilege, rationale)
values
  ('function', 'public.f_web_stats_summary(date,date)', 'authenticated', 'EXECUTE',
   'righthand_voice src/lib/stats/queries.ts:102 -- supabase.rpc(''f_web_stats_summary'', ...) via callRpc, on the cookie-backed server client (src/lib/supabase/server.ts), so the caller is `authenticated`. Reached from src/app/api/dashboard/statistics/route.ts:51 and src/app/righthand/doctor/(app)/statistics/page.tsx:19. SECURITY DEFINER with a user_id = auth.uid() predicate inside; the grant exposes only the caller''s own aggregates.'),

  ('function', 'public.f_web_stats_daily(date,date)', 'authenticated', 'EXECUTE',
   'righthand_voice src/lib/stats/queries.ts:103 -- same caller and same client as f_web_stats_summary. Feeds the 날짜별 내원 추이 line chart (StatisticsView.tsx:272).'),

  ('function', 'public.f_web_stats_diagnosis(date,date)', 'authenticated', 'EXECUTE',
   'righthand_voice src/lib/stats/queries.ts:104 -- same caller. Feeds the 질환별 분포 bar chart (StatisticsView.tsx:307).'),

  ('function', 'public.f_web_stats_chief_complaint(date,date)', 'authenticated', 'EXECUTE',
   'righthand_voice src/lib/stats/queries.ts:105 -- same caller. Feeds the 주소증별 분포 pie chart (StatisticsView.tsx:338).');

-- `public.web_stats_export_audit` is deliberately NOT listed: anon and
-- authenticated hold nothing on it (see section 1), so an allowlist row would
-- widen the guard past what is actually granted.

-- ===========================================================================
-- 4) Guard -- 0013's predicate, re-run over the objects this file just created
-- ===========================================================================
-- Verbatim from 0013:373-450 rather than a simplified version. A guard that
-- differs from the one it is standing in for can pass where the real one fails.
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
