-- realtime_doctor -- Migration 0010: close the PUBLIC EXECUTE holes on every
-- public-schema function.
--
-- Why this exists
-- ---------------
-- Postgres grants EXECUTE on a newly created function to PUBLIC by default.
-- `grant execute ... to service_role` therefore adds nothing and, worse, *reads*
-- like a restriction while granting nothing away from anyone. 0009 hit this in
-- production shape: `redeem_visit_access_code()` was reachable by `anon` -- an
-- unauthenticated browser -- and the probe caught it as an HTTP 200. 0009 fixed
-- its own four RPCs and left a note that 0006-0008 needed the same review.
--
-- This is that review, done against the live catalogue rather than by reading
-- the migrations, because the migrations are exactly what got it wrong the first
-- time. `select proacl from pg_proc` on the local stack showed ten functions
-- still carrying the implicit `=X/postgres` PUBLIC grant:
--
--   SECURITY DEFINER (a stray PUBLIC grant hands out the definer's privileges):
--     * public.record_care_activity_candidates(uuid, jsonb)     -- 0007
--     * public.set_care_activity_adoption(text,int,bool,text)   -- 0008
--     * public.is_admin()                                       -- 0000
--
--   SECURITY INVOKER (no escalation, but no reason to hand them out):
--     * public.set_updated_at()                                 -- 0002
--     * public.touch_care_activity_defs()                       -- 0006
--     * public.touch_care_activity_adoptions()                  -- 0008
--     * public.normalize_visit_code(text)                       -- 0009
--     * public.visit_code_alphabet() and five sibling constants  -- 0009
--
-- [HARD] The two care-activity RPCs were *not* protected. They re-derive the
-- owner from auth.uid() internally, so an anon call fails -- but it fails
-- because the function chose to look, not because the database refused the
-- call. That is being blocked by accident. If a later edit ever takes a
-- caller-supplied owner (the obvious "let the kiosk write on behalf of" change),
-- the accident evaporates silently and nothing in the schema objects.
--
-- The visit-code constant functions are the mildest case and still worth
-- closing: `visit_code_max_failures_per_minute()` tells an unauthenticated
-- attacker the exact rate limit and `visit_code_alphabet()` hands them the
-- keyspace. Neither is a break -- the design assumes the keyspace is public --
-- but the database should not be the one volunteering it.
--
-- Trigger functions (set_updated_at, touch_*) are only meaningfully callable
-- from a trigger context and error out otherwise. Revoked anyway: "it errors if
-- you call it" is the same kind of accidental protection as above.
--
-- Nothing here changes behaviour for a legitimate caller. Every revoke below is
-- paired with an explicit grant to the roles that were already using it.

-- ---------------------------------------------------------------------------
-- 0000 -- is_admin()
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, reads public.profiles. Called from admin-web RLS predicates
-- on the authenticated role.
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 0002 -- set_updated_at()
-- ---------------------------------------------------------------------------
-- Trigger function on subscriptions. Only the trigger owner needs it.
revoke all on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to service_role;

-- ---------------------------------------------------------------------------
-- 0006 -- touch_care_activity_defs()
-- ---------------------------------------------------------------------------
revoke all on function public.touch_care_activity_defs() from public;
grant execute on function public.touch_care_activity_defs() to service_role;

-- ---------------------------------------------------------------------------
-- 0007 -- record_care_activity_candidates()
-- ---------------------------------------------------------------------------
-- [HARD] SECURITY DEFINER. The desktop app calls this as `authenticated` after
-- a consultation ends. `anon` has never had a legitimate reason to call it.
revoke all on function public.record_care_activity_candidates(uuid, jsonb) from public;
grant execute on function public.record_care_activity_candidates(uuid, jsonb)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 0008 -- set_care_activity_adoption() and its trigger
-- ---------------------------------------------------------------------------
-- [HARD] SECURITY DEFINER. This is the clinical review gate: it is the one call
-- that turns detection on for a person. Leaving it PUBLIC meant the gate's
-- doorway was open and only the guard inside was checking badges.
revoke all on function public.set_care_activity_adoption(text, integer, boolean, text) from public;
grant execute on function public.set_care_activity_adoption(text, integer, boolean, text)
  to authenticated, service_role;

revoke all on function public.touch_care_activity_adoptions() from public;
grant execute on function public.touch_care_activity_adoptions() to service_role;

-- ---------------------------------------------------------------------------
-- 0009 -- helpers that the RPC revokes missed
-- ---------------------------------------------------------------------------
-- The four real RPCs were revoked in 0009. These seven were not.
revoke all on function public.normalize_visit_code(text) from public;
revoke all on function public.visit_code_alphabet() from public;
revoke all on function public.visit_code_length() from public;
revoke all on function public.visit_code_default_ttl_seconds() from public;
revoke all on function public.visit_code_max_live() from public;
revoke all on function public.visit_code_max_failures_per_minute() from public;
revoke all on function public.visit_code_max_redeems() from public;

grant execute on function public.normalize_visit_code(text) to authenticated, service_role;
grant execute on function public.visit_code_alphabet() to authenticated, service_role;
grant execute on function public.visit_code_length() to authenticated, service_role;
grant execute on function public.visit_code_default_ttl_seconds() to authenticated, service_role;
grant execute on function public.visit_code_max_live() to authenticated, service_role;
grant execute on function public.visit_code_max_failures_per_minute() to authenticated, service_role;
grant execute on function public.visit_code_max_redeems() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Default for everything created from here on
-- ---------------------------------------------------------------------------
-- The real fix is to stop the default from applying in the first place, so that
-- a future migration that forgets `revoke` is safe by construction instead of
-- safe by review. This changes the default privileges for functions created by
-- `postgres` in `public` -- the role every migration runs as.
--
-- This does NOT retroactively touch the functions above (hence the explicit
-- revokes), and it does NOT stop an author from writing an explicit
-- `grant ... to public`. It removes the silent path only.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Guard: fail the migration if any public-schema function still has PUBLIC
-- EXECUTE. A list that is checked once decays; a list that is checked by the
-- migration cannot.
-- ---------------------------------------------------------------------------
do $$
declare
  v_leaked text;
begin
  -- An ACL entry with an empty grantee is PUBLIC: '=X/postgres'. A named
  -- grantee ('authenticated=X/postgres') also contains '=X/', so the check has
  -- to anchor on the start of the entry, not search inside it.
  -- A null proacl means "defaults apply", and the function default includes
  -- PUBLIC EXECUTE -- so null is a leak too.
  select string_agg(t.sig, ', ' order by t.sig)
  into v_leaked
  from (
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        p.proacl is null
        or exists (
          select 1 from unnest(p.proacl::text[]) as acl
          where acl like '=%'
        )
      )
  ) t;

  if v_leaked is not null then
    raise exception 'public-schema functions still grant EXECUTE to PUBLIC: %', v_leaked;
  end if;
end;
$$;
