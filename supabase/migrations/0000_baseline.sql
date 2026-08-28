-- realtime_doctor -- Migration 0000: baseline (the schema that predates 0001).
--
-- Why this file exists
-- --------------------
-- The original tables of this app (sessions, transcript_chunks, analyses,
-- summaries, dictations, usage_events, profiles, devices) were created by hand
-- in the hosted Supabase project and never had a migration here. Every later
-- migration assumes them: 0001 does `alter table public.sessions add column
-- encounter_id`, 0005 alters and re-grants public.devices. A brand new, empty
-- project therefore could not be brought up at all -- 0001 failed on line one.
--
-- This file is that missing baseline, recovered from the queries the code
-- actually issues rather than from a dump. It is the first migration in the
-- chain: 0000 -> 0001 -> 0002 -> 0003 -> 0004 -> 0005.
--
-- Conventions (same as 0001):
--   * uuid primary keys via gen_random_uuid() (pgcrypto ships with Supabase)
--   * every timestamp is timestamptz
--   * user_id is the owning clinician (auth.users.id), which is what RLS
--     compares against auth.uid()
--   * the whole file is idempotent: re-running it is a no-op
--
-- [HARD] GRANT *and* RLS, always.
--   RLS decides which rows; GRANT decides whether the role may touch the table
--   at all. supabase/config.toml leaves `auto_expose_new_tables` unset, so a
--   newly created table grants nothing to anon/authenticated/service_role. A
--   previous migration in this repo enabled RLS without GRANT and every read
--   came back empty -- which reads as "there is no data", not as an error. Each
--   table below gets both, on purpose, in the same block.

create extension if not exists "pgcrypto";

-- ===========================================================================
-- profiles
-- ===========================================================================
-- Required: admin-web gates every admin route on `profiles.is_admin`
-- (admin-web/lib/admin-gate.ts:13, app/admin/layout.tsx:19) and renders the
-- user list from `user_id, email, created_at` (app/admin/users/page.tsx:19-20).
-- Without this table the admin console 500s on its first query.
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. Mirrors the signup email for the admin console and carries the is_admin flag.';
comment on column public.profiles.is_admin is
  'Admin console access. Never writable by the client: there is no insert/update GRANT for authenticated, so a doctor cannot promote themselves. Set it with service_role.';

create index if not exists profiles_created_at_idx on public.profiles (created_at desc);

-- Signup trigger, mirroring 0002's handle_new_user_subscription(): the row must
-- be created by the database, because an account made through the Supabase auth
-- API or the dashboard never touches app code.
create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
exception
  when others then
    -- Same tradeoff 0002 documents: this runs inside GoTrue's signup
    -- transaction, so an unhandled error would turn a broken profiles table
    -- into a total outage of registration. A missing profile row is
    -- recoverable (re-run the backfill below); a blocked signup is not.
    raise warning 'handle_new_user_profile failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

comment on function public.handle_new_user_profile() is
  'Creates the profiles row on signup. SECURITY DEFINER because GoTrue inserts into auth.users as a role with no rights on public.profiles.';

revoke all on function public.handle_new_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();

-- Backfill for accounts that predate the trigger. Idempotent.
insert into public.profiles (user_id, email)
select u.id, u.email
from auth.users u
where not exists (select 1 from public.profiles p where p.user_id = u.id)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- is_admin() -- used by the RLS policies below
-- ---------------------------------------------------------------------------
-- [HARD] SECURITY DEFINER, and that is not incidental. The policies on
-- public.profiles themselves call this function; if it were an ordinary
-- function its own SELECT on profiles would be filtered by the very policy
-- being evaluated, which is infinite recursion (Postgres raises
-- "infinite recursion detected in policy for relation profiles"). Running as
-- the owner bypasses RLS on that internal read and breaks the cycle.
--
-- It is deliberately not a general-purpose escape hatch: it returns a boolean
-- about the *caller* only, takes no arguments, and cannot be used to read
-- anyone's data.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.user_id = auth.uid()),
    false
  );
$$;

comment on function public.is_admin() is
  'True when the calling user has profiles.is_admin. SECURITY DEFINER to avoid RLS recursion on profiles. Read-only and argument-less by design.';

grant execute on function public.is_admin() to authenticated, service_role;

-- ===========================================================================
-- sessions -- one recording session
-- ===========================================================================
-- Column provenance (the query that proves each non-obvious column exists):
--   audio_path            src/main/sessions.ts:517  update({ audio_path: path })
--   transcribe_provider   src/main/sessions.ts:104  upsert transcribe_provider
--   ended_at              src/main/sessions.ts:415  update ended_at / :417 is null
--   title, color, pinned  admin-web/.../actions.ts:157,168,171 (alias/color/pin)
--   pinned_at             admin-web/lib/sessions-fetch.ts:45 select list
--   encounter_id          added by 0001, not here
create table if not exists public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  started_at          timestamptz not null default now(),
  ended_at            timestamptz,
  transcribe_provider text,
  audio_path          text,
  title               text,
  color               text check (
                        color is null
                        or color in ('gray','red','orange','yellow','green','blue','purple','pink')
                      ),
  pinned              boolean not null default false,
  pinned_at           timestamptz,
  created_at          timestamptz not null default now()
);

comment on table public.sessions is 'A recording session. Distinct from 0001''s `encounters`, which is a patient visit.';
comment on column public.sessions.audio_path is
  'Object path inside the `recordings` bucket: <user_id>/<session_id>/session.wav (src/main/sessions.ts:506).';
comment on column public.sessions.title is 'Operator-set alias shown in admin-web. Null means "use the timestamp".';
comment on column public.sessions.color is
  'One of admin-web/lib/session-colors.ts SESSION_COLORS. Constrained here so a typo in a patch cannot produce a colour the UI has no token for.';

create index if not exists sessions_user_started_idx on public.sessions (user_id, started_at desc);
create index if not exists sessions_pinned_idx on public.sessions (pinned) where pinned;

-- ===========================================================================
-- transcript_chunks
-- ===========================================================================
--   user_id      src/main/sessions.ts:446 insert user_id (needed for RLS and
--                for admin-web's per-user chunk count, .../[id]/page.tsx:80)
--   audio_path   src/main/sessions.ts:451 / :471 chunk WAV object path
--   chunk_id     app-generated id; relabel/delete address rows by
--                (session_id, chunk_id) -- sessions.ts:537-538, :555-556 --
--                so that pair carries a UNIQUE constraint.
create table if not exists public.transcript_chunks (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  chunk_id     text not null,
  speaker      text not null default 'unknown'
                 check (speaker in ('doctor', 'patient', 'unknown')),
  text         text not null default '',
  timestamp_ms bigint not null default 0,
  audio_path   text,
  created_at   timestamptz not null default now(),
  unique (session_id, chunk_id)
);

comment on column public.transcript_chunks.speaker is
  'Diarisation label. src/shared/types.ts:403 Speaker = doctor | patient | unknown; loadSession coerces anything else to unknown, so the check keeps the DB and the type in step.';
comment on column public.transcript_chunks.audio_path is
  'Per-chunk WAV in the `recordings` bucket: <user_id>/<session_id>/<chunk_id>.wav (src/main/sessions.ts:471).';

create index if not exists transcript_chunks_session_ts_idx
  on public.transcript_chunks (session_id, timestamp_ms);
create index if not exists transcript_chunks_user_id_idx on public.transcript_chunks (user_id);

-- ===========================================================================
-- analyses -- at most one per session
-- ===========================================================================
-- src/main/sessions.ts:587 upserts with `onConflict: 'session_id'`, so
-- session_id must carry a unique constraint or PostgREST rejects the upsert
-- with "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification". Making it the primary key states the 1:1 outright.
create table if not exists public.analyses (
  session_id             uuid primary key references public.sessions (id) on delete cascade,
  user_id                uuid not null references auth.users (id) on delete cascade,
  differential_diagnoses jsonb not null default '[]'::jsonb,
  medical_terms          jsonb not null default '[]'::jsonb,
  suggested_questions    jsonb not null default '[]'::jsonb,
  red_flags              jsonb not null default '[]'::jsonb,
  updated_at             timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

comment on table public.analyses is 'Live analysis for a session. One row per session (session_id is the PK) because the client upserts on session_id.';

create index if not exists analyses_user_id_idx on public.analyses (user_id);

-- ===========================================================================
-- summaries -- append-only, latest wins
-- ===========================================================================
-- src/main/sessions.ts:607 inserts (never upserts) and :313 reads the newest by
-- generated_at desc limit 1, so history is kept rather than overwritten.
create table if not exists public.summaries (
  id                          uuid primary key default gen_random_uuid(),
  session_id                  uuid not null references public.sessions (id) on delete cascade,
  user_id                     uuid not null references auth.users (id) on delete cascade,
  chief_complaint             text not null default '',
  history_of_present_illness  text not null default '',
  pertinent_findings          text not null default '',
  investigations_mentioned    text not null default '',
  clinical_impression         text not null default '',
  plan                        text not null default '',
  generated_at                timestamptz not null default now(),
  created_at                  timestamptz not null default now()
);

create index if not exists summaries_session_generated_idx
  on public.summaries (session_id, generated_at desc);
create index if not exists summaries_user_id_idx on public.summaries (user_id);

-- ===========================================================================
-- dictations -- append-only, latest wins
-- ===========================================================================
--   template  src/shared/types.ts:491 DictationTemplate = soap | apso | hp | narrative
--   sections  src/shared/types.ts:493 DictationSection[] -> jsonb array
create table if not exists public.dictations (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.sessions (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  template     text not null default 'soap'
                 check (template in ('soap', 'apso', 'hp', 'narrative')),
  sections     jsonb not null default '[]'::jsonb,
  generated_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index if not exists dictations_session_generated_idx
  on public.dictations (session_id, generated_at desc);
create index if not exists dictations_user_id_idx on public.dictations (user_id);

-- ===========================================================================
-- usage_events -- token/cost accounting
-- ===========================================================================
--   ts            the timestamp column is named `ts`, not created_at:
--                 admin-web/app/admin/page.tsx:199 `.gte('ts', sinceIso)`
--   session_id    NULLABLE and ON DELETE SET NULL. src/main/sessions.ts:629-634
--                 only attaches a session id once the cloud row is confirmed,
--                 precisely because a local-only session id would violate the FK.
--   app_version,
--   platform      src/main/sessions.ts:647-648
create table if not exists public.usage_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_id    uuid references public.sessions (id) on delete set null,
  provider      text not null,
  task          text not null,
  model         text not null default '',
  prompt_tokens integer,
  output_tokens integer,
  total_tokens  integer,
  chars         integer,
  duration_ms   integer,
  app_version   text,
  platform      text,
  ts            timestamptz not null default now()
);

comment on column public.usage_events.session_id is
  'Nullable on purpose: usage is still logged when the recording never reached the cloud (src/main/sessions.ts:629).';

create index if not exists usage_events_user_ts_idx on public.usage_events (user_id, ts desc);
create index if not exists usage_events_ts_idx on public.usage_events (ts desc);

-- ===========================================================================
-- devices
-- ===========================================================================
-- Created here in the shape that predates S5 -- WITHOUT revoked_at, which is
-- exactly the state the hosted project is in. 0005 then adds revoked_at with
-- `alter table ... add column if not exists` and re-applies the privileges. The
-- two files compose: 0005's `create table if not exists` is a no-op after this,
-- and its ALTER is the thing that actually runs, which is the same code path
-- the hosted project will take.
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
  unique (user_id, device_id)
);

comment on column public.devices.device_id is
  'Stable per-installation UUID from electron-store (src/main/store.ts getDeviceId). Not a hardware id.';

-- The Edge Function upserts on (user_id, device_id) -- supabase/functions/
-- device/index.ts `onConflict: 'user_id,device_id'` -- which the UNIQUE above
-- satisfies.

-- ===========================================================================
-- Privileges
-- ===========================================================================
-- `anon` is absent everywhere: nothing in this app talks to PostgREST without a
-- session. The Electron client authenticates before it writes anything.
grant select, insert, update, delete
  on public.sessions, public.transcript_chunks, public.analyses,
     public.summaries, public.dictations, public.usage_events
  to authenticated, service_role;

-- profiles: read-only for the client. is_admin is an authorisation bit, so
-- letting authenticated UPDATE it would be a one-line privilege escalation.
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.profiles to service_role;

-- devices: SELECT only for the client, for the reason 0005 spells out at
-- length -- the committed anon key means any client write privilege makes the
-- plan's device limit unenforceable. Every write goes through the `device`
-- Edge Function under service_role.
revoke all on public.devices from anon, authenticated;
grant select on public.devices to authenticated;
grant select, insert, update, delete on public.devices to service_role;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
-- 0001 noted that the pre-existing tables still ran with RLS off. They no
-- longer do. Every table here is PHI or accounting, and the anon key is
-- committed to the repository, so "RLS off" means any copy of the app can read
-- every doctor's transcripts.
--
-- [HARD] Why the policies are owner-OR-admin rather than owner-only:
--   admin-web reads and writes all of these tables with the *cookie* client,
--   i.e. as `authenticated`, not as service_role (getCookieSupabase in every
--   page under app/admin). It has its own admin gate in code
--   (ownerOrAdminGate, requireAdmin) and expects to see other clinicians' rows
--   once that gate passes. Under an owner-only policy the console would keep
--   passing its gate and then render nothing -- an empty page, not an error,
--   which is the exact failure mode this migration is written to avoid.
--   So the database enforces the same rule the application already states:
--   the owner, or an admin.

alter table public.profiles          enable row level security;
alter table public.sessions          enable row level security;
alter table public.transcript_chunks enable row level security;
alter table public.analyses          enable row level security;
alter table public.summaries         enable row level security;
alter table public.dictations        enable row level security;
alter table public.usage_events      enable row level security;
alter table public.devices           enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: read your own row, or every row if you are an admin. No write
-- policy and no write GRANT -- denied twice, as with devices.
drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
  on public.profiles for select
  to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- ---------------------------------------------------------------------------
-- The clinician-owned tables. All six carry user_id, so the rule is identical
-- and is applied in a loop rather than copy-pasted six times.
do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'transcript_chunks', 'analyses',
    'summaries', 'dictations', 'usage_events'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (user_id = (select auth.uid()) or public.is_admin()) '
      || 'with check (user_id = (select auth.uid()) or public.is_admin())',
      t || '_rw_own', t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- devices: SELECT own rows only. 0005 re-creates this same policy; both are
-- `drop policy if exists` + `create policy`, so applying them in order is fine.
drop policy if exists devices_select_own on public.devices;
create policy devices_select_own
  on public.devices for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ===========================================================================
-- Storage: the `recordings` bucket
-- ===========================================================================
-- Path convention, taken from the uploads themselves:
--   <user_id>/<session_id>/session.wav     src/main/sessions.ts:506
--   <user_id>/<session_id>/<chunk_id>.wav  src/main/sessions.ts:471
-- The first path segment is therefore the owner, which is what the policies
-- below key on. Reads happen through service-side signed URLs in admin-web
-- (createSignedUrl / createSignedUrls) and direct downloads in the client.
--
-- private (public = false): audio of a consultation is PHI. A public bucket
-- would make every object readable by anyone who can guess a session uuid.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;

-- The client uploads with `upsert: true` (sessions.ts:476, :510), which storage
-- implements as INSERT-or-UPDATE, so both verbs need a policy. DELETE is
-- included so a doctor can remove their own recordings.
drop policy if exists recordings_select_own on storage.objects;
create policy recordings_select_own
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recordings'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin())
  );

drop policy if exists recordings_insert_own on storage.objects;
create policy recordings_insert_own
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists recordings_update_own on storage.objects;
create policy recordings_update_own
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists recordings_delete_own on storage.objects;
create policy recordings_delete_own
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ===========================================================================
-- Realtime
-- ===========================================================================
-- Nothing here needs the publication. The only postgres_changes subscription in
-- the app is the waiting list on public.encounters (src/main/patients.ts:301),
-- which 0001 adds. Recording sessions are driven by IPC inside one process, not
-- by database events, so adding them would cost replication traffic and buy
-- nothing.
