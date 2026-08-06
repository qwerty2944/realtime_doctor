-- realtime_doctor -- Migration 0015: audit trail for desktop app downloads.
--
-- Why this table exists
-- ---------------------
-- The macOS installers are built with the owner's Gemini / OpenAI / CLOVA API
-- keys embedded at build time (`EMBEDDED_ENV_KEYS`, electron.vite.config.ts).
-- Whoever holds a copy of the .dmg can spend the owner's API credit, and the
-- app grants a 7-day trial on signup, so an anonymous download link is an open
-- invitation to sign up repeatedly with fresh addresses.
--
-- The download is therefore gated behind a session and every grant is recorded.
-- Attribution is the entire point: without a row here, "the same person made
-- eleven accounts" is not a question anyone can answer after the fact.
--
-- What a row actually attests
-- ---------------------------
-- [HARD] A row records that the server MINTED A SIGNED URL for a caller with a
-- verified session -- not that any bytes were transferred. The transfer runs
-- directly between the browser and Supabase Storage; the web server never sees
-- it and must not claim to. Read a row as "this account was handed the ability
-- to fetch this artifact at this time", which is exactly the fact that matters
-- for attribution.
--
-- request_ip / user_agent
-- -----------------------
-- Recorded because `user_id` alone cannot detect the specific abuse this gate
-- exists to stop. One person with eleven throwaway addresses is eleven distinct
-- user_ids and one recurring address. These two columns are the only signal in
-- the schema that links them, and they carry no clinical data.
--
-- Naming: `web_`
-- --------------
-- Same convention and same reason as 0014: the web owns objects prefixed `web_`
-- so a collision with the app's own tables is impossible by construction.
--
-- Additive and idempotent only
-- ----------------------------
-- No ALTER, no DROP, no UPDATE, no DELETE against any app-owned object. The only
-- reach outside web-owned territory is one foreign key onto `auth.users`.
-- Re-running the file is a no-op.
--
-- [HARD] Interaction with 0013 and 0014
-- -------------------------------------
-- `0013` rebuilds `public.role_privilege_allowlist` from scratch on every run.
-- This file adds no grant to `anon` or `authenticated`, so it contributes no
-- allowlist row and a 0013 re-run cannot invalidate it. `0014`'s pre-flight was
-- extended with this table's name in the same commit that added this file --
-- without that, re-running 0014 after this migration aborts on a `web_%` object
-- it does not recognise.

-- ===========================================================================
-- 0) Pre-flight: refuse to run if somebody else already owns the name
-- ===========================================================================
-- Same posture as 0014: half-applying onto a name we do not own is how a schema
-- collision on a production clinical database starts. Abort instead.
do $$
declare
  v_owned_relations constant text[] := array[
    'web_stats_export_audit',
    'web_app_download_audit'
  ];
  v_bad text;
begin
  select string_agg(format('relation public.%s', c.relname), ', ' order by c.relname)
  into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and c.relname like 'web\_%'
    and c.relname <> all (v_owned_relations);

  if v_bad is not null then
    raise exception
      E'public already contains web-prefixed objects this migration does not own: %\nRefusing to run: the prefix is meant to be collision-free and is not.',
      v_bad;
  end if;
end;
$$;

-- ===========================================================================
-- 1) web_app_download_audit
-- ===========================================================================
create table if not exists public.web_app_download_audit (
  id               uuid primary key default gen_random_uuid(),
  -- The signed-in account the grant was issued to, from the verified session.
  user_id          uuid        not null references auth.users (id) on delete cascade,
  -- Stable key for the artifact, e.g. 'mac-universal' / 'mac-arm64'. Kept
  -- alongside storage_path because the path changes between releases and the
  -- key is what a query groups by.
  artifact_key     text        not null check (btrim(artifact_key) <> ''),
  app_version      text        not null check (btrim(app_version) <> ''),
  storage_path     text        not null check (btrim(storage_path) <> ''),
  -- The digest the server published for this artifact at grant time. Stored so
  -- a later "which build did this account actually get?" is answerable even
  -- after the object at that path has been replaced.
  sha256           text        not null check (sha256 ~ '^[0-9a-f]{64}$'),
  -- How long the minted URL stayed redeemable. Recorded rather than assumed:
  -- the value is a code constant today and a row must remain readable if it
  -- ever changes.
  url_ttl_seconds  integer     not null check (url_ttl_seconds > 0 and url_ttl_seconds <= 3600),
  -- Nullable: behind a proxy the forwarded address can be absent or unparseable,
  -- and a missing address is not a reason to refuse a legitimate download.
  request_ip       inet,
  user_agent       text,
  created_at       timestamptz not null default now()
);

comment on table public.web_app_download_audit is
  'One row per signed URL minted for a desktop-app installer. Records a GRANT, not a completed transfer: the bytes move directly between the browser and Storage and the web server never observes them. No PHI. Written only by the web server on service_role; anon and authenticated hold nothing, so a client can neither suppress nor forge an entry.';

comment on column public.web_app_download_audit.request_ip is
  'Caller address at grant time. Present because user_id alone cannot link one person operating several throwaway accounts, which is the abuse this download gate exists to stop.';

-- Per-account history: "what has this doctor pulled, and how often".
create index if not exists web_app_download_audit_user_idx
  on public.web_app_download_audit (user_id, created_at desc);

-- Chronological sweep: "who pulled anything in the last day", and the scan
-- behind any address-reuse review. Separate from the index above because that
-- one cannot serve a query with no user_id predicate.
create index if not exists web_app_download_audit_recent_idx
  on public.web_app_download_audit (created_at desc);

-- service_role only. An audit row the audited party can write or edit is not an
-- audit row, so there is deliberately no grant for `authenticated` here and
-- therefore no allowlist entry for this table below.
revoke all on public.web_app_download_audit from anon, authenticated;
grant select, insert on public.web_app_download_audit to service_role;

alter table public.web_app_download_audit enable row level security;
-- No policy for any client role: denied twice (no GRANT, no policy).

-- ===========================================================================
-- 2) Storage
-- ===========================================================================
-- The installers live in the PRIVATE `app-releases` bucket under
-- `mac/<version>/<file>.dmg`. No RLS policy is created for it on purpose:
--
--   * With no policy, `anon` and `authenticated` can neither read, list nor
--     sign an object in the bucket -- verified: an anon list returns `[]` and a
--     signed-URL request returns 404.
--   * The ONLY way to a signed URL is the service-role client inside
--     `doctor-web`, which runs after the session check in
--     `src/app/api/dashboard/downloads/route.ts`.
--
-- [HARD] Do not add a storage policy granting `authenticated` read on this
-- bucket. It would let any signed-in browser mint its own unlogged URL, which
-- removes both the audit row and the short TTL -- that is, the gate itself.
--
-- The bucket is created through the Storage API rather than here: `storage.buckets`
-- is owned by the Storage service and inserting into it from a migration is not
-- the supported path. Settings applied: private, 256 MiB file-size limit,
-- allowed_mime_types = ['application/x-apple-diskimage']. The project-wide
-- upload limit was raised from its 50 MiB default to 256 MiB for the same
-- reason; the pre-existing `recordings` bucket was pinned to 50 MiB first so
-- that its effective limit did not change.

-- ===========================================================================
-- 3) Guard -- 0013's predicate, re-run over the object this file just created
-- ===========================================================================
-- Verbatim from 0013:373-450 (as re-used by 0014) rather than a simplified
-- version. A guard that differs from the one it is standing in for can pass
-- where the real one fails.
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
