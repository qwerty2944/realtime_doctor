-- realtime_doctor -- Migration 0012: the decision audit trail
-- (tasks/architecture-and-liability.md sec.6).
--
-- Why this exists
-- ---------------
-- Lam et al., Nature 655:1129-1132: "there will be no easy way to determine how
-- much a clinician was swayed by a machine's recommendation." When a court asks
-- whether reliance on this system was reasonable, we currently have nothing to
-- answer with.
--
-- Our deployment makes the handoff unusually legible, and that is the whole
-- opportunity: the kiosk produces an interpretation with no clinician present,
-- and the desktop app is the first place a clinician sees it. There is a single
-- identifiable moment where a machine's opinion crosses into a human's. That
-- moment is what this table records.
--
-- What we record, and what each event does NOT prove
-- --------------------------------------------------
-- Every row is something the application genuinely observed. Nothing here is
-- inferred from attention, dwell time, mouse movement or window focus.
--
--   interpretation_presented
--     The kiosk's interpretation was handed to the desktop for display, with
--     the differential list, red flag, recommended tests and the provenance
--     from 0011 captured as they stood.
--     PROVES: this exact content, from this exact model and prompt version, was
--       what the app put in front of this clinician.
--     DOES NOT PROVE: that anyone read it.
--
--   patient_detail_opened
--     The clinician selected this patient in the waiting list and the app
--     switched every overlay window to that patient's record.
--     PROVES: a deliberate human act naming this patient at this time. The
--       earliest such row is the answer to "when did the clinician first open
--       this patient's detail".
--     DOES NOT PROVE: that any particular item on screen was read.
--
--   differential_expanded
--     A named differential card was expanded, which is what loads its detail.
--     PROVES: the clinician deliberately opened that specific diagnosis.
--     DOES NOT PROVE: agreement, adoption, or that the reasoning was read.
--
--   evidence_requested
--     A PubMed lookup was requested for a named diagnosis.
--     PROVES: the clinician sought an independent check on that diagnosis --
--       the strongest signal available to us that reliance was not blind.
--     DOES NOT PROVE: that the literature was read or that it changed anything.
--
--   finding_source_opened
--     A supporting finding was clicked, sending the transcript window to the
--     utterance the machine cited.
--     PROVES: the clinician checked a machine-cited quote against the raw
--       record.
--     DOES NOT PROVE: that the check succeeded, or what they concluded from it.
--
--   summary_generated
--     A summary was generated for a consultation while this interpretation was
--     the active one.
--     PROVES: the encounter reached documentation with the interpretation
--       present.
--     DOES NOT PROVE: that the summary was accepted or used.
--
-- [HARD] What we deliberately refuse to record
-- --------------------------------------------
--   * No "adopted" / "overrode" / "ignored" flag. The app never learns the
--     clinician's own diagnosis, so any such label would be inferred. Inferring
--     "override" from the ABSENCE of an event is the worst version: it would
--     manufacture, in a liability record, exactly the claim a court would lean
--     on. Absence is stored as absence. The trail says what happened; it does
--     not narrate what did not.
--   * No dwell time, scroll depth, focus duration, idle detection or pointer
--     data. A window being frontmost is not attention, and a fabricated
--     attention signal in a liability record is worse than no signal.
--   * No counts. Each event carries a dedupe key, so the trail answers "this
--     happened, and first at this time" and cannot answer "how many times".
--     Repetition counts are an engagement metric pointed at the doctor, and
--     this table exists to answer whether reliance was reasonable, not to score
--     anyone.
--   * No cross-clinician visibility. RLS scopes every row to its owner; there
--     is no vendor-side read path and no aggregate.
--
-- Append-only
-- -----------
-- A liability record that can be edited is not a record. Enforcement is in
-- three layers, because grants alone were not enough in 0005 or 0007:
--   1. No INSERT/UPDATE/DELETE grant to anon or authenticated at all. Writes go
--      through record_clinical_decision_event() only.
--   2. RLS permits SELECT of own rows and nothing else.
--   3. A trigger rejects UPDATE and DELETE for EVERY role including
--      service_role, so a leaked service key cannot rewrite history either.
--      Legal erasure has a documented, deliberate escape hatch (below) that no
--      PostgREST client can reach.

create table if not exists public.clinical_decision_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  encounter_id uuid not null references public.encounters (id) on delete cascade,
  -- Which interpretation was on screen. Null for events that are not about a
  -- stored intake (a live consultation summary, for instance).
  intake_result_id uuid references public.intake_results (id) on delete set null,
  session_id   uuid,
  event_type   text not null check (event_type in (
    'interpretation_presented',
    'patient_detail_opened',
    'differential_expanded',
    'evidence_requested',
    'finding_source_opened',
    'summary_generated'
  )),
  -- What distinguishes one occurrence from a repeat of the same one: the
  -- intake_result id, or the diagnosis name, or the utterance id. Null means
  -- "every occurrence is its own event" (patient_detail_opened).
  dedupe_key   text,
  -- What was on screen. For interpretation_presented this is the differential
  -- list, the red flag, the recommended tests and the 0011 provenance, frozen
  -- as they stood -- so the trail survives a later re-derivation.
  payload      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

comment on table public.clinical_decision_events is
  'Append-only record of the machine-to-clinician handoff. Exists to answer "was this reliance reasonable", not to measure the clinician. Never updated, never deleted outside legal erasure.';
comment on column public.clinical_decision_events.dedupe_key is
  'Deliberately makes the table unable to count. We record that something happened and when it first happened; repetition counts would be an engagement metric pointed at the doctor.';
comment on column public.clinical_decision_events.payload is
  'A frozen copy of what was shown, including model/prompt provenance. Frozen rather than joined so a later re-derivation cannot change what the record says was on screen.';

-- One row per distinct occurrence. Rows with a null dedupe_key are exempt --
-- Postgres treats nulls as distinct in a unique index, which is exactly the
-- "every occurrence is its own event" behaviour we want there.
create unique index if not exists clinical_decision_events_once_idx
  on public.clinical_decision_events (encounter_id, event_type, dedupe_key)
  where dedupe_key is not null;

create index if not exists clinical_decision_events_encounter_idx
  on public.clinical_decision_events (encounter_id, occurred_at);
create index if not exists clinical_decision_events_user_idx
  on public.clinical_decision_events (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Append-only trigger
-- ---------------------------------------------------------------------------
-- Applies to every role. service_role is not exempt: the point of an audit
-- trail is that the party who benefits from editing it cannot.
--
-- The one exception is a right-to-erasure request, which is a real legal
-- obligation and cannot be designed away. It requires setting a session GUC
-- from a direct database connection. PostgREST clients cannot set it, and anon
-- and authenticated hold no DELETE grant regardless, so the exception is two
-- doors away from anything a client can reach.
create or replace function public.reject_clinical_decision_event_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception
      'clinical_decision_events is append-only: row % cannot be updated', old.id
      using errcode = '42501';
  end if;

  if coalesce(current_setting('rd.audit_erasure', true), 'off') <> 'on' then
    raise exception
      'clinical_decision_events is append-only: row % cannot be deleted', old.id
      using errcode = '42501';
  end if;

  return old;
end;
$$;

comment on function public.reject_clinical_decision_event_mutation() is
  'Blocks UPDATE unconditionally and DELETE unless rd.audit_erasure=on is set on a direct database session. Applies to service_role too -- an audit trail its own operator can rewrite is not one.';

drop trigger if exists clinical_decision_events_append_only on public.clinical_decision_events;
create trigger clinical_decision_events_append_only
  before update or delete on public.clinical_decision_events
  for each row execute function public.reject_clinical_decision_event_mutation();

-- ---------------------------------------------------------------------------
-- record_clinical_decision_event -- the only writer
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so no client ever needs an INSERT grant. Ownership is
-- re-derived from auth.uid() and re-checked against the encounter; the caller
-- cannot file an event under someone else's name or against a patient that is
-- not theirs.
--
-- Returns whether a row was written. A repeat of an already-recorded event is
-- not an error -- the desktop calls this on ordinary UI actions and must not
-- surface failures to a clinician mid-consultation.
create or replace function public.record_clinical_decision_event(
  p_encounter_id uuid,
  p_event_type text,
  p_dedupe_key text default null,
  p_payload jsonb default '{}'::jsonb,
  p_intake_result_id uuid default null,
  p_session_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'p_payload must be a json object' using errcode = '22023';
  end if;

  -- Ownership from the encounter row, never from the caller.
  if not exists (
    select 1 from public.encounters e
    where e.id = p_encounter_id and e.user_id = v_uid
  ) then
    raise exception 'encounter not found for this user' using errcode = '42501';
  end if;

  -- An intake_result_id that does not belong to this encounter would let the
  -- trail claim a clinician was shown a different patient's interpretation.
  if p_intake_result_id is not null and not exists (
    select 1 from public.intake_results r
    where r.id = p_intake_result_id and r.encounter_id = p_encounter_id
  ) then
    raise exception 'intake_result % does not belong to encounter %',
      p_intake_result_id, p_encounter_id using errcode = '22023';
  end if;

  insert into public.clinical_decision_events (
    user_id, encounter_id, intake_result_id, session_id,
    event_type, dedupe_key, payload
  ) values (
    v_uid, p_encounter_id, p_intake_result_id, p_session_id,
    p_event_type, nullif(p_dedupe_key, ''), p_payload
  )
  on conflict (encounter_id, event_type, dedupe_key) where dedupe_key is not null
  do nothing
  returning id into v_id;

  return jsonb_build_object(
    'recorded', v_id is not null,
    'id', v_id
  );
end;
$$;

comment on function public.record_clinical_decision_event(uuid, text, text, jsonb, uuid, uuid) is
  'Only writer for clinical_decision_events. Owner re-derived from auth.uid(); a repeat of an already-recorded event is a no-op, not an error.';

-- ===========================================================================
-- Privileges
-- ===========================================================================
-- SELECT own rows, EXECUTE the writer. No INSERT/UPDATE/DELETE for either
-- client role, and no UPDATE/DELETE even for service_role -- the trigger would
-- reject them anyway, and a grant that only exists to be rejected is a lie
-- about the schema's intent.
revoke all on function public.record_clinical_decision_event(uuid, text, text, jsonb, uuid, uuid) from public;
revoke all on function public.reject_clinical_decision_event_mutation() from public;
grant execute on function public.record_clinical_decision_event(uuid, text, text, jsonb, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.reject_clinical_decision_event_mutation() to service_role;

grant select on public.clinical_decision_events to authenticated;
grant select, insert on public.clinical_decision_events to service_role;

alter table public.clinical_decision_events enable row level security;

-- Read-only, own rows. There is no insert policy: the SECURITY DEFINER writer
-- is the only path in, so adding one would create a second door.
drop policy if exists clinical_decision_events_select_own on public.clinical_decision_events;
create policy clinical_decision_events_select_own
  on public.clinical_decision_events for select
  to authenticated
  using (user_id = auth.uid());
