-- realtime_doctor -- production privilege audit.
--
-- What this answers
-- -----------------
-- "Do `anon` or `authenticated` hold any privilege in the public schema that
-- migration 0013's allowlist does not justify?"
--
-- Why it exists as a separate file
-- --------------------------------
-- The local Supabase stack does NOT reproduce the hosted project's default
-- privileges. `pg_default_acl` for (postgres, public, functions) is
-- `{postgres=X/postgres}` locally but grants `anon` and `authenticated` on the
-- hosted project -- which is precisely why migrations 0009 and 0010 looked clean
-- locally while every function on production was callable by an unauthenticated
-- browser. A local pass therefore proves the migration APPLIES; it does not
-- prove the defect is closed. Only this file, run against production, does that.
--
-- This is read-only. It contains no DDL and no DML and cannot change anything.
--
-- How to run it
-- -------------
-- Preferred (shows every section, and exits non-zero on failure):
--
--     psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/audit/named-role-privileges.sql
--
-- where SUPABASE_DB_URL is the project's direct connection string
-- (Dashboard -> Project Settings -> Database -> Connection string -> URI).
--
-- Without a local psql, the same thing through the CLI's database container:
--
--     docker exec -i supabase_db_realtime_doctor \
--       psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--       -f /dev/stdin < supabase/audit/named-role-privileges.sql
--
-- In the Dashboard SQL editor: run PART 1 and PART 2 as two separate
-- selections. The editor only renders the last result set, so pasting the whole
-- file shows the verdict but hides the detail that explains it.
--
-- Reading the result
-- ------------------
-- PART 1 section C is the answer. Zero rows = closed. Any row = a privilege
-- `anon` or `authenticated` holds that nothing in the codebase justifies.
-- PART 2 turns the same query into a hard failure so the file can be used in a
-- script without anyone having to eyeball it.

-- ===========================================================================
-- PART 0 -- refuse to report on a database that has no criteria
-- ===========================================================================
-- [HARD] This runs FIRST, before any report is printed. An audit that emits
-- fifty rows of "what anon holds" against a database where the allowlist does
-- not exist looks like a result and is not one -- the reader has no way to tell
-- "nothing is wrong" from "nothing was checked". That confusion is the exact
-- failure this whole file exists to correct, so it is refused at the door
-- rather than annotated further down.
do $$
begin
  if to_regclass('public.role_privilege_allowlist') is null then
    raise exception
      'public.role_privilege_allowlist does not exist -- migration 0013 has not been applied to this database. Refusing to report a verdict.';
  end if;
end;
$$;

\echo ''
\echo '=== PART 1 / A -- default privileges (the mechanism behind the defect) ==='
\echo 'Rows naming anon or authenticated for (postgres, public) mean future'
\echo 'objects are still born open. 0013 is supposed to have cleared those.'
\echo ''

select
  pg_get_userbyid(d.defaclrole)                    as creating_role,
  n.nspname                                        as schema,
  case d.defaclobjtype
    when 'r' then 'tables'
    when 'S' then 'sequences'
    when 'f' then 'functions'
    when 'T' then 'types'
    when 'n' then 'schemas'
  end                                              as object_type,
  d.defaclacl::text                                as default_acl
from pg_default_acl d
join pg_namespace n on n.oid = d.defaclnamespace
where n.nspname = 'public'
order by creating_role, object_type;

\echo ''
\echo '=== PART 1 / B -- what anon and authenticated actually hold right now ==='
\echo ''

with held as (
  select
    'function'                        as object_kind,
    p.oid::regprocedure::text         as object_name,
    pg_get_userbyid(e.grantee)        as grantee,
    e.privilege_type                  as privilege,
    p.oid                             as object_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) e
  where n.nspname = 'public'
    and e.grantee <> 0
  union all
  select
    'relation',
    c.oid::regclass::text,
    pg_get_userbyid(e.grantee),
    e.privilege_type,
    c.oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) e
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and e.grantee <> 0
)
select object_kind, object_name, grantee, privilege
from held
where grantee in ('anon', 'authenticated')
order by object_kind, object_name, grantee, privilege;

\echo ''
\echo '=== PART 1 / C -- VIOLATIONS (this is the verdict; expect zero rows) ==='
\echo ''

-- The allowlist is read from public.role_privilege_allowlist, the table
-- migration 0013 populates. This file deliberately does NOT carry its own copy:
-- a second list is a list that drifts, and a drifted audit is an audit that
-- passes for the wrong reason.
--
-- Objects are matched by OID via to_regprocedure/to_regclass rather than by
-- text, so a search_path difference between this session and the migration
-- session cannot make the two disagree about which object is which.
select * from (
  -- (a) functions still reachable by PUBLIC (0010's original check).
  -- A null proacl means "defaults apply", and the built-in function default
  -- includes PUBLIC EXECUTE, so null is a leak too.
  select
    'function'                        as object_kind,
    p.oid::regprocedure::text         as object_name,
    'PUBLIC'                          as grantee,
    'EXECUTE'                         as privilege,
    'reachable without any credential' as note
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proacl is null
         or exists (select 1 from aclexplode(p.proacl) e where e.grantee = 0))

  union all

  -- (b) functions reachable by a named client role outside the allowlist.
  -- This is the class of hole 0010's guard could not see.
  select
    'function',
    p.oid::regprocedure::text,
    a.role,
    a.priv,
    case when p.prosecdef
         then 'SECURITY DEFINER -- a stray grant hands out the definer''s privileges'
         else 'no escalation, but no justified caller either'
    end
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

  -- (c) relations reachable by PUBLIC. Unlike functions, a null relacl means
  -- owner-only, so it is correctly not matched here.
  select
    'relation',
    c.oid::regclass::text,
    'PUBLIC',
    e.privilege_type,
    'reachable without any credential'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) e
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
    and e.grantee = 0

  union all

  -- (d) relations reachable by a named client role outside the allowlist.
  -- TRUNCATE/REFERENCES/TRIGGER are included on purpose: row level security
  -- does not filter TRUNCATE, so "RLS will stop them" is not an answer for it.
  select
    'relation',
    c.oid::regclass::text,
    a.role,
    a.priv,
    case
      when a.priv = 'TRUNCATE' then 'RLS does not filter TRUNCATE'
      when c.relrowsecurity   then 'RLS is the only thing holding'
      else 'NO RLS on this relation -- directly reachable'
    end
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
) v
order by object_kind, object_name, grantee, privilege;

\echo ''
\echo '=== PART 1 / D -- the allowlist itself, so the verdict can be argued with ==='
\echo ''

select object_kind, object_name, grantee, privilege, rationale
from public.role_privilege_allowlist
order by object_kind, object_name, grantee, privilege;

-- ===========================================================================
-- PART 2 -- the same question as a pass/fail
-- ===========================================================================
-- Raises if PART 1 / C returned anything. With `-v ON_ERROR_STOP=1` this makes
-- psql exit non-zero, so the audit can be wired into a script without anyone
-- reading the output.
--
-- It also fails if public.role_privilege_allowlist is missing, rather than
-- treating an absent allowlist as an empty one. An audit that reports "clean"
-- because it could not find its own criteria is the failure mode this whole
-- exercise is about.

\echo ''
\echo '=== PART 2 -- verdict ==='
\echo ''

do $$
declare
  v_bad text;
begin
  if to_regclass('public.role_privilege_allowlist') is null then
    raise exception
      'public.role_privilege_allowlist does not exist -- migration 0013 has not been applied to this database. Refusing to report a verdict.';
  end if;

  select string_agg(format('%s %s -> %s %s (%s)',
                           v.object_kind, v.object_name, v.grantee, v.privilege, v.note),
                    E'\n  ' order by v.object_kind, v.object_name, v.grantee, v.privilege)
  into v_bad
  from (
    select 'function' as object_kind, p.oid::regprocedure::text as object_name,
           'PUBLIC' as grantee, 'EXECUTE' as privilege,
           'reachable without any credential' as note
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) e where e.grantee = 0))

    union all

    select 'function', p.oid::regprocedure::text, a.role, a.priv,
           case when p.prosecdef then 'SECURITY DEFINER' else 'security invoker' end
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral (
      select pg_get_userbyid(e.grantee) as role, e.privilege_type as priv
      from aclexplode(p.proacl) e where e.grantee <> 0
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

    select 'relation', c.oid::regclass::text, 'PUBLIC', e.privilege_type,
           'reachable without any credential'
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) e
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and e.grantee = 0

    union all

    select 'relation', c.oid::regclass::text, a.role, a.priv,
           case
             when a.priv = 'TRUNCATE' then 'RLS does not filter TRUNCATE'
             when c.relrowsecurity   then 'RLS is the only thing holding'
             else 'NO RLS on this relation'
           end
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      select pg_get_userbyid(e.grantee) as role, e.privilege_type as priv
      from aclexplode(c.relacl) e where e.grantee <> 0
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
  ) v;

  if v_bad is not null then
    raise exception E'FAIL -- public schema privileges outside the allowlist:\n  %', v_bad;
  end if;

  raise notice 'PASS -- anon and authenticated hold nothing in the public schema outside public.role_privilege_allowlist.';
end;
$$;
