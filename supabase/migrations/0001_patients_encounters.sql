-- realtime_doctor -- Migration 0001: patient / encounter / intake schema.
--
-- Ported (and trimmed) from the RightHand intake service so this app can read a
-- waiting list produced by a separate intake kiosk. Only the tables the Electron
-- client actually reads are created here; the kiosk-side tables (messages,
-- consult_records, test_master, ...) are intentionally left out.
--
-- Conventions:
--   * uuid primary keys via gen_random_uuid() (pgcrypto ships with Supabase)
--   * every timestamp is timestamptz
--   * user_id is the owning clinician (auth.users.id), which is what RLS compares
--     against auth.uid(). The existing tables (sessions, transcript_chunks, ...)
--     already use the same user_id convention.
--
-- The whole file is idempotent: re-running it is a no-op.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
create table if not exists public.patients (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  birth_date      date,
  registration_no text,
  phone           text,
  created_at      timestamptz not null default now()
);

comment on table public.patients is 'Patients owned by a single clinician (user_id).';
comment on column public.patients.registration_no is 'Hospital registration number. Nullable: the front desk may fill it in later.';

create index if not exists patients_user_id_idx on public.patients (user_id);
create index if not exists patients_created_at_idx on public.patients (created_at desc);

-- ---------------------------------------------------------------------------
-- encounters
-- ---------------------------------------------------------------------------
-- One visit. Named "encounters" rather than "sessions" because this app already
-- has a `sessions` table meaning "a recording session".
create table if not exists public.encounters (
  id              uuid primary key default gen_random_uuid(),
  patient_id      uuid not null references public.patients (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  status          text not null default 'intake_in_progress'
                    check (status in ('intake_in_progress', 'intake_done', 'in_consult', 'completed')),
  red_flag        boolean not null default false,
  red_flag_reason text,
  chief_complaint text,
  -- Consent, mirroring RightHand's three separate consents (0001_init.sql on
  -- `sessions`). Recorded here rather than on `patients` because consent is given
  -- per visit and must be retained with the visit it authorised.
  consent_privacy   boolean not null default false,
  consent_recording boolean not null default false,
  consent_ai        boolean not null default false,
  consented_at      timestamptz,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

comment on column public.encounters.chief_complaint is 'Denormalised from the latest intake_results.soap_json for cheap waiting-list rendering.';

-- `create table if not exists` above is a no-op on a database that predates the
-- consent columns, so add them explicitly too. Both paths end up identical.
alter table public.encounters
  add column if not exists consent_privacy   boolean not null default false,
  add column if not exists consent_recording boolean not null default false,
  add column if not exists consent_ai        boolean not null default false,
  add column if not exists consented_at      timestamptz;

comment on column public.encounters.consent_privacy is 'Consent 1/3: collection and use of personal information.';
comment on column public.encounters.consent_recording is 'Consent 2/3: audio recording.';
comment on column public.encounters.consent_ai is 'Consent 3/3: processing by an external LLM API.';
comment on column public.encounters.consented_at is 'When the patient accepted the consent screen. Null means no consent was recorded.';

create index if not exists encounters_user_status_idx on public.encounters (user_id, status);
create index if not exists encounters_patient_id_idx on public.encounters (patient_id);
create index if not exists encounters_created_at_idx on public.encounters (created_at desc);
-- Red flagged encounters are pinned to the top of the waiting list.
create index if not exists encounters_red_flag_idx on public.encounters (red_flag) where red_flag;

-- ---------------------------------------------------------------------------
-- intake_results (AI generated draft, written by the intake kiosk)
-- ---------------------------------------------------------------------------
create table if not exists public.intake_results (
  id                     uuid primary key default gen_random_uuid(),
  encounter_id           uuid not null references public.encounters (id) on delete cascade,
  soap_json              jsonb not null default '{}'::jsonb,
  differentials_json     jsonb not null default '[]'::jsonb,
  recommended_tests_json jsonb not null default '[]'::jsonb,
  version                integer not null default 1,
  created_at             timestamptz not null default now(),
  unique (encounter_id, version)
);

comment on column public.intake_results.soap_json is
  'Shape: {"s":{"chief_complaint":text,"hpi":text,"pmh":text,"medications":text,"allergies":text},"o":text,"a":text,"p":text}';
comment on column public.intake_results.differentials_json is
  'Ordered array (index 0 = highest priority): [{"rank":int,"name_kr":text,"name_en":text,"rationale":text}]';

create index if not exists intake_results_encounter_id_idx on public.intake_results (encounter_id);

-- ---------------------------------------------------------------------------
-- evidence_lookups (PubMed lookup cache, keyed by diagnosis name)
-- ---------------------------------------------------------------------------
-- Not PHI: only a diagnosis name and the public literature that came back.
create table if not exists public.evidence_lookups (
  id           uuid primary key default gen_random_uuid(),
  diagnosis    text not null,
  results_json jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

-- Cache lookups are case-insensitive, so the index has to be too.
create index if not exists evidence_lookups_diagnosis_lower_idx
  on public.evidence_lookups (lower(diagnosis));
create index if not exists evidence_lookups_created_at_idx on public.evidence_lookups (created_at desc);

-- ---------------------------------------------------------------------------
-- sessions.encounter_id -- links a recording session to a visit
-- ---------------------------------------------------------------------------
-- Nullable on purpose: every existing recording session predates this schema and
-- ad-hoc recordings without a registered patient stay valid.
alter table public.sessions
  add column if not exists encounter_id uuid references public.encounters (id) on delete set null;

create index if not exists sessions_encounter_id_idx on public.sessions (encounter_id);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- The waiting list subscribes to postgres_changes on public.encounters so a
-- finished intake -- and especially a red flag -- appears without the doctor
-- reloading. A table only emits those events once it is a member of the
-- supabase_realtime publication; without this the subscription connects and then
-- never fires, which looks like an empty waiting room rather than a failure.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'encounters'
  ) then
    alter publication supabase_realtime add table public.encounters;
  end if;
end;
$$;

-- FULL so UPDATE events carry the previous row too.
alter table public.encounters replica identity full;

-- ===========================================================================
-- Row Level Security
-- ===========================================================================
-- The pre-existing tables still run with RLS off (see src/main/supabaseClient.ts).
-- These are the first PHI tables in this project, so they are locked down from
-- day one; tightening the older tables is a separate task.

-- Table privileges. RLS decides *which rows*; GRANT decides whether the role may
-- touch the table at all, and a newly created table grants nothing to the
-- PostgREST roles. Without this the kiosk (service_role) fails its very first
-- insert with "permission denied for table patients", and the Electron client
-- (authenticated) sees an empty waiting list -- both look like data problems
-- rather than a privilege problem.
--
-- `anon` is deliberately absent: patients never authenticate against the
-- database, they go through the kiosk's server-side routes.
grant select, insert, update, delete
  on public.patients, public.encounters, public.intake_results, public.evidence_lookups
  to authenticated, service_role;

alter table public.patients         enable row level security;
alter table public.encounters       enable row level security;
alter table public.intake_results   enable row level security;
alter table public.evidence_lookups enable row level security;

-- patients / encounters: the owning clinician only.
do $$
declare
  t text;
begin
  foreach t in array array['patients', 'encounters'] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_rw_own', t
    );
  end loop;
end;
$$;

-- intake_results: no user_id of its own; scoped through its encounter.
drop policy if exists intake_results_rw_own on public.intake_results;
create policy intake_results_rw_own
  on public.intake_results for all
  to authenticated
  using (
    exists (
      select 1 from public.encounters e
      where e.id = intake_results.encounter_id
        and e.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.encounters e
      where e.id = intake_results.encounter_id
        and e.user_id = (select auth.uid())
    )
  );

-- evidence_lookups: a shared, non-PHI cache. Any signed-in clinician may read it
-- and add to it, but nobody may rewrite or delete another doctor's cache entry.
drop policy if exists evidence_lookups_select_authenticated on public.evidence_lookups;
create policy evidence_lookups_select_authenticated
  on public.evidence_lookups for select
  to authenticated
  using (true);

drop policy if exists evidence_lookups_insert_authenticated on public.evidence_lookups;
create policy evidence_lookups_insert_authenticated
  on public.evidence_lookups for insert
  to authenticated
  with check (true);
