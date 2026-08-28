-- realtime_doctor -- Migration 0013: close the *named-role* privilege holes that
-- 0009 and 0010 could not see.
--
-- The defect
-- ----------
-- 0009 and 0010 close function-execute holes with `revoke ... from public`. On a
-- Supabase project that is not sufficient, and the reason is a detail of how
-- Postgres stores an ACL.
--
-- A function's ACL is a list of entries. The implicit "everyone" grant is the
-- entry with an EMPTY grantee -- `=X/postgres`. `revoke ... from public` removes
-- exactly that one entry and nothing else. Supabase, separately, ships
-- `alter default privileges ... grant execute on functions to anon,
-- authenticated, service_role`, which puts *named* entries into every new
-- function's ACL -- `anon=X/postgres`, `authenticated=X/postgres`. Those are not
-- the PUBLIC entry, so `revoke ... from public` leaves them standing.
--
-- The result on the live project (yhwvwojjwwlcrvpfxgag, audited after 0006-0012
-- were applied): `anon` and `authenticated` hold explicit EXECUTE on every
-- function in `public`, including the ones written to be service_role-only.
-- Supabase's own advisor lint `anon_security_definer_function_executable` names
-- them: redeem_visit_access_code, rederive_intake_interpretation,
-- bind_visit_access_code_encounter, record_visit_code_failure,
-- issue_visit_access_code, set_care_activity_adoption,
-- record_care_activity_candidates, record_clinical_decision_event, is_admin.
--
-- The first of those is the exact function 0009 was written to protect. The
-- sixth is the clinical-review gate itself.
--
-- The same mechanism applies to tables. 0005 got this right for `public.devices`
-- (`revoke all ... from anon, authenticated` before the grant, leaving
-- `authenticated=r/postgres`). 0006-0012 did not, so the "denied twice (no
-- GRANT, no policy)" claim written into those files is currently denied ONCE --
-- RLS is the only thing holding. Nothing is breached, because none of those
-- tables has an INSERT/UPDATE/DELETE policy for a client role and RLS denies by
-- default. But the defence-in-depth the comments assert is absent, and one
-- permissive policy added by a future migration is all it would take to convert
-- an over-grant into a breach.
--
-- Even the local stack is not clean, contrary to what an eyeball check of
-- 0010 suggested. `pg_default_acl` for (postgres, public, tables) here is
-- `{postgres=arwdDxtm, anon=Dxtm, authenticated=Dxtm, service_role=Dxtm}`, so
-- every table created since 0006 carries `anon=Dxtm` -- TRUNCATE, REFERENCES,
-- TRIGGER, MAINTAIN. TRUNCATE is NOT filtered by row level security. PostgREST
-- has no TRUNCATE verb so it is not reachable over the API today, but "the
-- protocol in front of it happens not to expose the verb" is not an
-- authorisation decision.
--
-- Why 0010's guard did not catch any of this
-- ------------------------------------------
-- [HARD] The guard in 0010 anchors on `acl like '=%'` -- an ACL entry whose
-- grantee is empty. That is the PUBLIC entry and only the PUBLIC entry. A named
-- grantee (`anon=X/postgres`) can never match it. The guard cannot see this
-- class of hole BY CONSTRUCTION, and it passed on the live database while every
-- function there was callable by `anon`. A guard that cannot see the hole it is
-- guarding against is worse than no guard: it converts an open door into a
-- signed-off one. 0010's guard is left in place (it must still pass at 0010
-- time, before this file runs) but it is superseded by the guard at the bottom
-- of this file, which checks named grantees as well as PUBLIC, for relations as
-- well as functions.
--
-- What this file does
-- -------------------
--   1. Records the intended caller of every object as DATA, in
--      public.role_privilege_allowlist, with the evidence for each entry.
--   2. Revokes everything from anon/authenticated/PUBLIC across the whole public
--      schema, then re-grants strictly from that allowlist.
--   3. Closes the default privileges for the NAMED roles, not just PUBLIC.
--   4. Guards, against the allowlist, and fails the migration on any violation.
--
-- The allowlist is a table rather than a comment so the production audit script
-- (supabase/audit/named-role-privileges.sql) reads the same source of truth the
-- migration enforced, instead of a second copy that can drift from it.

-- ===========================================================================
-- 1) The allowlist
-- ===========================================================================
create table if not exists public.role_privilege_allowlist (
  -- 'function' -> object_name is a regprocedure signature, schema-qualified.
  -- 'relation' -> object_name is a schema-qualified table or view name.
  object_kind text not null check (object_kind in ('function', 'relation')),
  object_name text not null,
  -- Only the two PostgREST client roles are listed. service_role is deliberately
  -- out of scope: it is the server's own identity, it bypasses RLS anyway, and
  -- enumerating it here would turn this table into a second copy of the schema.
  grantee text not null check (grantee in ('anon', 'authenticated')),
  privilege text not null,
  -- [HARD] Not decoration. An entry with no evidence is a guess, and a guess is
  -- how 0007/0008 got their holes. Cite the call site or the policy that needs it.
  rationale text not null,
  primary key (object_kind, object_name, grantee, privilege)
);

comment on table public.role_privilege_allowlist is
  'Every privilege anon or authenticated is permitted to hold in the public schema, with the evidence for each. Read by the 0013 guard and by supabase/audit/named-role-privileges.sql, so the migration and the production audit cannot disagree.';
comment on column public.role_privilege_allowlist.rationale is
  'The call site or RLS policy that requires this grant. An entry without one is a guess; guesses are what this migration exists to remove.';

-- Rebuilt from scratch on every run so a re-applied migration cannot leave a
-- stale entry behind that quietly widens the guard.
delete from public.role_privilege_allowlist;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
-- Every public-schema function was read, and its callers were searched for
-- across src/, kiosk/, admin-web/, scripts/ and supabase/functions/. Only four
-- have a caller that is not service_role. The other twenty do not, and the
-- grants they were given (0009/0010 handed the visit-code tunables and
-- normalize_visit_code to `authenticated`) were written for a caller that was
-- never built: both clients reimplement normalisation in TypeScript
-- (src/shared/visitCode.ts, kiosk/lib/intake/visitCode.ts) and neither reads a
-- tunable over PostgREST.
insert into public.role_privilege_allowlist
  (object_kind, object_name, grantee, privilege, rationale)
values
  ('function', 'public.is_admin()', 'authenticated', 'EXECUTE',
   'Evaluated INSIDE RLS predicates, which run as the querying role, not as the table owner. 0000_baseline.sql lines 381/397/439: "using (user_id = (select auth.uid()) or public.is_admin())" on sessions/transcript_chunks/... and on storage.objects. Without this grant every admin-web read as `authenticated` fails with "permission denied for function is_admin".'),

  ('function', 'public.record_care_activity_candidates(uuid, jsonb)', 'authenticated', 'EXECUTE',
   'src/main/careActivities.ts:449 -- supabase.rpc(''record_care_activity_candidates'', ...) on the Electron main-process client, which holds a user session and therefore acts as `authenticated`.'),

  ('function', 'public.set_care_activity_adoption(text, integer, boolean, text)', 'authenticated', 'EXECUTE',
   'src/main/careActivities.ts:241 -- supabase.rpc(''set_care_activity_adoption'', ...). This is the clinical-review gate; the clinician taking responsibility is by definition signed in.'),

  ('function', 'public.issue_visit_access_code(text, integer)', 'authenticated', 'EXECUTE',
   'src/main/visitCodes.ts:63 -- supabase.rpc(''issue_visit_access_code'', ...). Issued by a signed-in clinician at the front desk. Redemption is a different function and stays service_role-only.'),

  ('function', 'public.record_clinical_decision_event(uuid, text, text, jsonb, uuid, uuid)', 'authenticated', 'EXECUTE',
   'src/main/decisionTrail.ts:81 -- supabase.rpc(''record_clinical_decision_event'', ...), guarded by getCurrentUser(), so the caller is always `authenticated`. [HARD] This one is easy to lose by accident and expensive to lose: decisionTrail.ts warns on failure and does not rethrow (it must not interrupt a clinician mid-consultation), so a missing grant would silently stop the entire liability audit trail while the app looked healthy.');

-- Deliberately NOT listed, i.e. anon and authenticated get nothing:
--
--   redeem_visit_access_code(uuid,text,text,boolean)
--     kiosk/lib/intake/visitCodeServer.ts:85, on the service-role client
--     (kiosk/lib/supabase service client). 0009's header is explicit that the
--     browser must not be able to name a clinician and start guessing.
--   bind_visit_access_code_encounter(uuid, uuid)
--     kiosk/lib/intake/visitCodeServer.ts:136, same service-role client.
--   record_visit_code_failure(uuid, timestamptz)
--     No external caller at all; invoked only from inside
--     redeem_visit_access_code, which is SECURITY DEFINER and runs as postgres.
--   rederive_intake_interpretation(uuid, jsonb, jsonb)
--     No caller in the app. 0011 states server-only, and
--     scripts/probe-provenance.mjs:821 already ASSERTS that a signed-in user is
--     refused. Granting it would break that probe, which is the correct
--     direction of causality.
--   intake_facts_fingerprint(jsonb)
--     Read only by scripts/probe-provenance.mjs:369, and that probe reaches it
--     over a direct psql connection as `postgres`, not over PostgREST.
--     probe-provenance.mjs:812 asserts anon is refused.
--   normalize_visit_code(text), visit_code_alphabet(), visit_code_length(),
--   visit_code_default_ttl_seconds(), visit_code_max_live(),
--   visit_code_max_failures_per_minute(), visit_code_max_redeems()
--     0009/0010 granted these to `authenticated` for a reader that does not
--     exist: no .rpc() call anywhere names them, and both clients carry their
--     own copy of the alphabet and the length. They are called internally by
--     issue/redeem, which are SECURITY DEFINER and therefore run as postgres.
--     0010's own header argues for closing them ("the database should not be
--     the one volunteering" the keyspace and the rate limit); it then granted
--     them to `authenticated` anyway. This finishes that argument.
--   set_updated_at(), touch_care_activity_defs(),
--   touch_care_activity_adoptions(), set_intake_facts_fingerprint(),
--   reject_clinical_decision_event_mutation()
--     Trigger functions. A trigger fires as the table owner regardless of who
--     issued the statement, so no client grant is ever needed.
--   handle_new_user_profile(), handle_new_user_subscription()
--     auth.users triggers. 0000:82 and 0002:301 already revoked these from
--     anon and authenticated by name -- they are the only two places in the
--     repo that got the named-grantee problem right, which is why they are the
--     only two functions this file does not have to change.

-- ---------------------------------------------------------------------------
-- Relations
-- ---------------------------------------------------------------------------
-- Reconstructed from the GRANT block of every migration that created the table.
-- This file changes no intent; it makes the intent the whole of what is held.
insert into public.role_privilege_allowlist
  (object_kind, object_name, grantee, privilege, rationale)
select 'relation', v.rel, v.role, p.priv, v.why
from (values
  -- 0000 -- consultation record. The Electron client owns these rows outright.
  ('public.sessions',            'authenticated', 'SIUD', '0000:328 grant select,insert,update,delete to authenticated. src/main/sessions.ts writes them directly.'),
  ('public.transcript_chunks',   'authenticated', 'SIUD', '0000:328. src/main/sessions.ts streams chunks in as the signed-in user.'),
  ('public.analyses',            'authenticated', 'SIUD', '0000:328. Upserted per session by the desktop analysis loop.'),
  ('public.summaries',           'authenticated', 'SIUD', '0000:328.'),
  ('public.dictations',          'authenticated', 'SIUD', '0000:328.'),
  ('public.usage_events',        'authenticated', 'SIUD', '0000:328.'),
  -- 0000 -- profiles carries the is_admin authorisation bit: read-only, always.
  ('public.profiles',            'authenticated', 'S',    '0000:335 grant select only. UPDATE would be a one-line privilege escalation via is_admin.'),
  -- 0005 -- the shape this whole file is copying.
  ('public.devices',             'authenticated', 'S',    '0005:145-146. Read-only for the client; every write goes through the `device` Edge Function on service_role, because the committed anon key makes any client write grant an unenforceable device limit.'),
  -- 0001 -- PHI.
  ('public.patients',            'authenticated', 'SIUD', '0001:172.'),
  ('public.encounters',          'authenticated', 'SIUD', '0001:172.'),
  ('public.intake_results',      'authenticated', 'SIUD', '0001:172.'),
  ('public.evidence_lookups',    'authenticated', 'SIUD', '0001:172.'),
  -- 0002 -- billing. plans is the one place anon is intentional.
  ('public.plans',               'anon',          'S',    '0002:165 grant select on plans to anon, authenticated -- a price list is public by design. No PHI, no per-user rows.'),
  ('public.plans',               'authenticated', 'S',    '0002:165.'),
  ('public.payment_attempts',    'authenticated', 'S',    '0002:192 grant select only. Writes are the billing routes on service_role.'),
  ('public.subscriptions_self',  'authenticated', 'S',    '0002:257. The view exists precisely so `subscriptions` itself needs no client grant.'),
  -- 0006-0012 -- the tables this migration was opened for.
  ('public.care_activity_defs',       'authenticated', 'S', '0006:187 grant select only. Writes are service_role: if authenticated could UPDATE, a client could promote its own unreviewed row past the review gate.'),
  ('public.care_activity_candidates', 'authenticated', 'S', '0007:269 grant select only. The supersession invariant lives in record_care_activity_candidates(); a client that could UPDATE could rewrite its own history.'),
  ('public.care_activity_adoptions',  'authenticated', 'S', '0008:225 grant select only. Direct writes would allow forging reviewed_by or approving on another clinician''s behalf.'),
  ('public.visit_access_codes',       'authenticated', 'S', '0009:607 grant select only, so the issuing dialog can list outstanding codes. A write grant would let a client mint a code with any expiry, for any user_id.'),
  ('public.clinical_decision_events', 'authenticated', 'S', '0012:268 grant select only. Append-only: the sole writer is record_clinical_decision_event().')
) as v(rel, role, privs, why)
cross join lateral (
  select unnest(
    case v.privs
      when 'SIUD' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']
      when 'S'    then array['SELECT']
    end
  ) as priv
) p;

-- Relations deliberately absent, i.e. anon and authenticated get nothing at all:
--   public.subscriptions            -- 0002:181. Read through subscriptions_self.
--   public.webhook_events           -- 0002:206. PortOne payloads.
--   public.billing_issue_requests   -- 0003:46.
--   public.subscription_watchdog_runs -- 0004:79.
--   public.visit_access_code_attempts -- 0009:646. The rate-limiter's own state;
--     letting a client read it tells an attacker how much budget is left.
--   public.role_privilege_allowlist -- this table. service_role only.
-- Every one of the first four already carried an explicit
-- `revoke all ... from anon, authenticated`, which is why they are the tables
-- that came out of the live audit clean.

-- ===========================================================================
-- 2) Revoke everything, then re-grant from the allowlist
-- ===========================================================================
-- Blanket revoke first. Enumerating what to take away is how this went wrong
-- twice already: 0009 enumerated four RPCs and missed seven helpers, 0010
-- enumerated ten functions against a catalogue query that could not see named
-- grantees. Taking everything away and handing back only what the allowlist
-- justifies is the only shape that cannot miss an object.
--
-- service_role is untouched throughout: it is the server's identity and its
-- grants were set deliberately by each migration.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all routines in schema public from public, anon, authenticated;

do $$
declare
  v_row record;
  v_missing text;
begin
  -- [HARD] Fail loudly if an allowlist entry names something that does not
  -- exist. A typo in a signature would otherwise silently drop a grant the app
  -- needs and, worse, silently widen the guard below (a row that resolves to
  -- NULL matches nothing and therefore forgives nothing -- but it also protects
  -- nothing, and the missing runtime grant would surface as a production 403).
  select string_agg(w.object_kind || ' ' || w.object_name, ', ' order by w.object_name)
  into v_missing
  from public.role_privilege_allowlist w
  where (w.object_kind = 'function' and to_regprocedure(w.object_name) is null)
     or (w.object_kind = 'relation' and to_regclass(w.object_name) is null);

  if v_missing is not null then
    raise exception 'role_privilege_allowlist names objects that do not exist: %', v_missing;
  end if;

  for v_row in
    select object_kind, object_name, grantee, privilege
    from public.role_privilege_allowlist
    order by object_kind, object_name, grantee, privilege
  loop
    if v_row.object_kind = 'function' then
      execute format(
        'grant %s on function %s to %I',
        v_row.privilege, v_row.object_name, v_row.grantee
      );
    else
      execute format(
        'grant %s on table %s to %I',
        v_row.privilege, v_row.object_name, v_row.grantee
      );
    end if;
  end loop;
end;
$$;

-- The allowlist itself: service_role only, like every other piece of
-- infrastructure state in this schema.
grant select, insert, update, delete on public.role_privilege_allowlist to service_role;

alter table public.role_privilege_allowlist enable row level security;
-- No policy for any client role: denied twice (no GRANT, no policy) -- and this
-- time that claim is true, because the blanket revoke above is what makes it true.

-- ===========================================================================
-- 3) Default privileges, for the NAMED roles this time
-- ===========================================================================
-- 0010 wrote:
--     alter default privileges for role postgres in schema public
--       revoke execute on functions from public;
-- which is the same half-measure as the revokes it was fixing. It removes the
-- implicit PUBLIC entry from future functions and leaves the named entries.
--
-- pg_default_acl is keyed by (creating role, schema, object type). The role that
-- matters is the one that CREATES the object, which for every migration in this
-- repo is `postgres` -- `supabase db push` and the dashboard SQL editor both
-- connect as postgres. So closing the (postgres, public, *) entries closes the
-- silent path for everything a future migration creates.
--
-- What this can NOT close, stated plainly rather than assumed away:
--   * Objects created by `supabase_admin`. Its default ACL for schema public
--     (visible in pg_default_acl) does grant anon/authenticated, and `postgres`
--     is not a member of supabase_admin, so ALTER DEFAULT PRIVILEGES FOR ROLE
--     supabase_admin would fail outright. Nothing in this repo creates objects
--     as supabase_admin; Supabase's own extensions do, in their own schemas.
--   * A future migration writing an explicit `grant ... to anon`. That is a
--     deliberate act and should be a deliberate act; the guard below is what
--     makes it a visible one.
-- Both residual paths are covered by the guard, not by this statement. That is
-- the intended division of labour: the default closes the silent path, the
-- guard catches everything else.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
-- FUNCTIONS and ROUTINES are synonyms in ALTER DEFAULT PRIVILEGES (they are not
-- synonyms in GRANT/REVOKE, which is why both appear in the blanket revoke
-- above but only one appears here).
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- ===========================================================================
-- 4) auth_rls_initplan -- consistency inside the 0006-0012 batch
-- ===========================================================================
-- 0008 and 0009 write `(select auth.uid())`; 0007 and 0012 write a bare
-- `auth.uid()`. The parenthesised form is evaluated once as an InitPlan instead
-- of once per row. Cosmetic at current row counts, but it is an inconsistency
-- inside a single batch of migrations, and Supabase's advisor flags it
-- (auth_rls_initplan) on exactly these two policies. Same predicate, same rows.
drop policy if exists care_activity_candidates_select_own on public.care_activity_candidates;
create policy care_activity_candidates_select_own
  on public.care_activity_candidates for select
  to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists clinical_decision_events_select_own on public.clinical_decision_events;
create policy clinical_decision_events_select_own
  on public.clinical_decision_events for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ===========================================================================
-- 5) The guard
-- ===========================================================================
-- Replaces 0010's, which anchored on `acl like '=%'` and could therefore only
-- ever see the PUBLIC entry. This one enumerates the ACL properly with
-- aclexplode() and checks three things at once:
--
--   * PUBLIC still holds nothing (0010's check, kept -- it was not wrong, only
--     incomplete),
--   * `anon` and `authenticated` hold no function EXECUTE outside the allowlist,
--   * `anon` and `authenticated` hold no relation privilege outside the
--     allowlist -- including TRUNCATE, REFERENCES and TRIGGER, which RLS does
--     not filter and which the local stack was in fact handing out.
--
-- Objects are matched by OID (to_regprocedure / to_regclass), not by text, so a
-- search_path difference between the migration session and a later audit session
-- cannot make the two disagree about which function is which.
--
-- The proof that this guard fires is not this file: it is
-- scripts/probe-provenance.mjs, which plants a real hole (`grant execute ... to
-- anon`), re-runs this exact predicate, and asserts it is reported.
do $$
declare
  v_bad text;
begin
  select string_agg(x.line, E'\n  ' order by x.line)
  into v_bad
  from (
    -- (a) functions still reachable by PUBLIC. A null proacl means "defaults
    -- apply", and the built-in function default includes PUBLIC EXECUTE, so
    -- null is a leak too.
    select format('function %s -> PUBLIC EXECUTE', p.oid::regprocedure::text) as line
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proacl is null
           or exists (select 1 from aclexplode(p.proacl) e where e.grantee = 0))

    union all

    -- (b) functions reachable by a named client role outside the allowlist.
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

    -- (c) relations reachable by PUBLIC. Unlike functions, a null relacl means
    -- owner-only, so it is not a leak and is correctly not matched here.
    select format('relation %s -> PUBLIC %s', c.oid::regclass::text, e.privilege_type)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) e
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
      and e.grantee = 0

    union all

    -- (d) relations reachable by a named client role outside the allowlist.
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
