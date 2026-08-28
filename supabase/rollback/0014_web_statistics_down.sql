-- realtime_doctor -- Rollback of 0014_web_statistics.sql.
--
-- Restores the exact pre-0014 schema. Every object dropped here was created by
-- 0014; nothing the native app owns is touched. 0014 makes no ALTER, no DROP and
-- no data change to an app-owned object, so there is nothing else to undo.
--
-- DATA LOSS: `web_stats_export_audit` is dropped with its contents — the record
-- of who exported clinic-wide statistics and when. Back it up first if the web
-- dashboard has been in use:
--
--   \copy public.web_stats_export_audit to 'web_stats_export_audit.csv' csv header
--
-- The table holds no PHI (user id, two dates, a row count), so the backup is not
-- itself a clinical record.

-- ---------------------------------------------------------------------------
-- 1) Allowlist rows first
-- ---------------------------------------------------------------------------
-- Before the functions, not after: 0013's own pre-flight raises if the allowlist
-- names an object that does not exist, so a row left pointing at a dropped
-- function would fail the next run of 0013.
delete from public.role_privilege_allowlist
where object_kind = 'function'
  and object_name in (
    'public.f_web_stats_daily(date,date)',
    'public.f_web_stats_diagnosis(date,date)',
    'public.f_web_stats_chief_complaint(date,date)',
    'public.f_web_stats_summary(date,date)'
  );

-- ---------------------------------------------------------------------------
-- 2) Reporting functions
-- ---------------------------------------------------------------------------
drop function if exists public.f_web_stats_summary(date, date);
drop function if exists public.f_web_stats_diagnosis(date, date);
drop function if exists public.f_web_stats_chief_complaint(date, date);
drop function if exists public.f_web_stats_daily(date, date);

-- ---------------------------------------------------------------------------
-- 3) Export audit table
-- ---------------------------------------------------------------------------
drop table if exists public.web_stats_export_audit;

-- ---------------------------------------------------------------------------
-- 4) Verify
-- ---------------------------------------------------------------------------
-- The rollback is only complete if no web-prefixed object survives. A partially
-- dropped 0014 would leave a grant standing with no allowlist row behind it,
-- which is exactly the state 0013's guard exists to reject.
do $$
declare
  v_left text;
begin
  select string_agg(x.line, ', ' order by x.line)
  into v_left
  from (
    select format('relation public.%s', c.relname) as line
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'web\_%'

    union all

    select format('function public.%s', p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'f\_web\_%'
  ) x;

  if v_left is not null then
    raise exception 'rollback incomplete, web-prefixed objects remain: %', v_left;
  end if;
end;
$$;
