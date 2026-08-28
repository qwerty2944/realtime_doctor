-- realtime_doctor -- Migration 0011: separate facts from interpretation, and give
-- every interpretation provenance (E3, tasks/evidence-first-plan.md).
--
-- The problem
-- -----------
-- `intake_results` stores what the patient SAID (soap_json.transcript, the
-- structured S fields) in the same blob as what the machine CONCLUDED
-- (differentials_json, the SOAP A and P, the red flag). Those are different
-- kinds of thing. The first is a record; the second is an opinion. Once they
-- are mixed, nobody can later separate them, and the question a court actually
-- asks -- "which model, on which prompt, produced this recommendation, and was
-- relying on it reasonable?" -- has no answer in our data at all.
--
-- Why this extends the table instead of splitting it
-- --------------------------------------------------
-- Splitting facts into their own table was the obvious move and it is the wrong
-- one here, for three reasons:
--
--   1. `intake_results` ALREADY implements supersession. `version` plus
--      `unique (encounter_id, version)` means a re-derivation is a new row and
--      the old one is untouched. The readers (src/main/patients.ts, the kiosk)
--      already take the highest version. The mechanism E3 asks for exists; what
--      is missing is provenance and an enforced facts boundary, not a table.
--   2. The transcript is read from `soap_json.transcript` by three independent
--      consumers (src/renderer/shared/patientMode.ts, src/main/careActivities.ts,
--      four probes). Moving it makes every one of them a shape migration, on a
--      reader that is deliberately defensive about shape. Breaking the
--      defensive reader to satisfy a normalisation preference is a bad trade.
--   3. A row that carries its own facts is self-contained. Reconstructing "what
--      the clinician was looking at" from a join is exactly the kind of
--      reconstruction a liability record should not require.
--
-- So: one row per interpretation, carrying a verbatim copy of the facts it was
-- derived from, plus provenance, plus a pointer to the row it re-derives.
--
-- The facts boundary is ENFORCED, not documented
-- ----------------------------------------------
-- A comment saying "do not change the facts on a re-derivation" is worth
-- nothing. `rederive_intake_interpretation()` below does not accept facts at
-- all: it reads them out of the source row itself and writes them. The caller
-- supplies only the opinion. It is not possible to re-derive an interpretation
-- and alter the record in the same call, because there is no parameter for it.
--
-- `facts_fingerprint` then makes the preservation checkable rather than
-- trusted: sha256 over the transcript and the structured subjective fields. A
-- re-derived row carries the same fingerprint as its source. If it ever does
-- not, the history was rewritten and the fingerprint says so.
--
-- Existing rows
-- -------------
-- Every column added here is nullable or defaulted. Rows written before this
-- migration keep working exactly as they did; their provenance is `{}`, which
-- the readers render as "출처 미기록" rather than inventing a model name. An
-- absent provenance is a true statement about an old row. A fabricated one
-- would not be.

-- ---------------------------------------------------------------------------
-- intake_results: provenance + supersession + facts fingerprint
-- ---------------------------------------------------------------------------
alter table public.intake_results
  add column if not exists interpretation_provenance jsonb not null default '{}'::jsonb,
  add column if not exists facts_fingerprint text,
  add column if not exists derived_from_id uuid,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'intake_results_derived_from_fk'
  ) then
    alter table public.intake_results
      add constraint intake_results_derived_from_fk
      foreign key (derived_from_id) references public.intake_results (id)
      on delete set null;
  end if;

  -- Deferrable for the same reason as 0007: the replacement row's id has to be
  -- written onto the old row before the replacement itself exists.
  if not exists (
    select 1 from pg_constraint where conname = 'intake_results_superseded_by_fk'
  ) then
    alter table public.intake_results
      add constraint intake_results_superseded_by_fk
      foreign key (superseded_by) references public.intake_results (id)
      on delete set null
      deferrable initially deferred;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'intake_results_supersede_complete'
  ) then
    alter table public.intake_results
      add constraint intake_results_supersede_complete
      check ((superseded_at is null) = (superseded_by is null));
  end if;
end;
$$;

comment on column public.intake_results.interpretation_provenance is
  'Where the OPINION in this row came from: {engine, provider, model, promptVersion, schemaVersion, generatedAt}. Empty object = written before 0011; readers must render that as "unrecorded", never as a guess.';
comment on column public.intake_results.facts_fingerprint is
  'sha256 over the facts (soap_json.transcript + soap_json.s). A re-derivation carries its source''s fingerprint; a mismatch means the record was rewritten, not re-interpreted.';
comment on column public.intake_results.derived_from_id is
  'The row whose FACTS this interpretation was re-derived from. Null for a first interpretation.';
comment on column public.intake_results.superseded_by is
  'The interpretation that replaced this one. Supersession is the only permitted change; no interpretation column is ever updated in place.';

create index if not exists intake_results_current_idx
  on public.intake_results (encounter_id, version desc)
  where superseded_at is null;

-- ---------------------------------------------------------------------------
-- Fingerprint helper -- one definition, so the writer and any verifier agree
-- ---------------------------------------------------------------------------
-- jsonb's canonical text form is key-sorted and whitespace-free, so equal
-- documents hash equal without a normalisation pass of our own.
create or replace function public.intake_facts_fingerprint(p_soap jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  -- pg_catalog.sha256, not pgcrypto's digest(): pgcrypto lives in the
  -- `extensions` schema and search_path is pinned to public here, so digest()
  -- would need qualifying against a schema whose location is a Supabase
  -- convention rather than a guarantee. sha256() is built in.
  select encode(
    sha256(
      convert_to(
        coalesce(p_soap -> 'transcript', '[]'::jsonb)::text
          || '|' || coalesce(p_soap -> 's', '{}'::jsonb)::text,
        'UTF8'
      )
    ),
    'hex'
  );
$$;

comment on function public.intake_facts_fingerprint(jsonb) is
  'Fingerprint of the FACTS only: the dialogue and the structured subjective fields. Deliberately excludes o/a/p, which are interpretation and are expected to change between derivations.';

-- The fingerprint is computed by the database, never accepted from a client.
-- A client-supplied fingerprint is a claim about the facts made by the same
-- party that wrote them, which is worth exactly nothing.
create or replace function public.set_intake_facts_fingerprint()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.facts_fingerprint := public.intake_facts_fingerprint(new.soap_json);
  return new;
end;
$$;

drop trigger if exists intake_results_facts_fingerprint on public.intake_results;
create trigger intake_results_facts_fingerprint
  before insert or update of soap_json on public.intake_results
  for each row execute function public.set_intake_facts_fingerprint();

revoke all on function public.set_intake_facts_fingerprint() from public;
grant execute on function public.set_intake_facts_fingerprint() to service_role;

-- ---------------------------------------------------------------------------
-- rederive_intake_interpretation -- the only way to re-interpret a record
-- ---------------------------------------------------------------------------
-- Takes the id of an existing interpretation and a NEW opinion. Copies the
-- facts across itself. Marks the source superseded and inserts the replacement
-- at version+1. The source row's payload columns are never touched.
--
-- service_role only, and deliberately so: re-derivation is a server operation
-- run when a model or prompt changes, not something a client initiates. There
-- is no clinician-facing "re-run the AI" path yet, and inventing an EXECUTE
-- grant for a caller that does not exist is how the 0007/0008 holes happened.
create or replace function public.rederive_intake_interpretation(
  p_source_id uuid,
  p_interpretation jsonb,
  p_provenance jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_source     public.intake_results%rowtype;
  v_new_id     uuid := gen_random_uuid();
  v_version    integer;
  v_soap       jsonb;
begin
  select * into v_source from public.intake_results where id = p_source_id;
  if not found then
    raise exception 'intake_result % not found', p_source_id using errcode = '42704';
  end if;
  if v_source.superseded_at is not null then
    raise exception 'intake_result % is already superseded by %',
      p_source_id, v_source.superseded_by using errcode = '22023';
  end if;
  if jsonb_typeof(p_interpretation) <> 'object' then
    raise exception 'p_interpretation must be a json object' using errcode = '22023';
  end if;
  if jsonb_typeof(p_provenance) <> 'object' or p_provenance = '{}'::jsonb then
    raise exception 'a re-derivation must state its provenance' using errcode = '22023';
  end if;

  -- The facts come from the source row. There is no parameter that could
  -- change them, which is the whole point of this function existing.
  v_soap := jsonb_build_object(
    's',          coalesce(v_source.soap_json -> 's', '{}'::jsonb),
    'transcript', coalesce(v_source.soap_json -> 'transcript', '[]'::jsonb)
  );

  -- Non-clinical carry-overs the kiosk stores alongside the facts. They are
  -- interpretation, so the caller may replace them; absent means "carry the
  -- old ones forward" rather than "silently drop them".
  v_soap := v_soap
    || jsonb_build_object(
         'o', coalesce(p_interpretation -> 'o', v_source.soap_json -> 'o', '""'::jsonb),
         'a', coalesce(p_interpretation -> 'a', v_source.soap_json -> 'a', '""'::jsonb),
         'p', coalesce(p_interpretation -> 'p', v_source.soap_json -> 'p', '""'::jsonb),
         'follow_up_questions', coalesce(
           p_interpretation -> 'follow_up_questions',
           v_source.soap_json -> 'follow_up_questions',
           '[]'::jsonb),
         'medical_terms', coalesce(
           p_interpretation -> 'medical_terms',
           v_source.soap_json -> 'medical_terms',
           '[]'::jsonb)
       );

  select coalesce(max(version), 0) + 1 into v_version
  from public.intake_results where encounter_id = v_source.encounter_id;

  update public.intake_results
  set superseded_at = now(), superseded_by = v_new_id
  where id = p_source_id;

  insert into public.intake_results (
    id, encounter_id, soap_json, differentials_json, recommended_tests_json,
    version, interpretation_provenance, facts_fingerprint, derived_from_id
  ) values (
    v_new_id,
    v_source.encounter_id,
    v_soap,
    coalesce(p_interpretation -> 'differentials', v_source.differentials_json),
    coalesce(p_interpretation -> 'recommended_tests', v_source.recommended_tests_json),
    v_version,
    p_provenance,
    -- Recomputed from what was actually written, not copied from the source.
    -- Copying would make the fingerprint a claim; recomputing makes it evidence.
    public.intake_facts_fingerprint(v_soap),
    p_source_id
  );

  return jsonb_build_object(
    'id', v_new_id,
    'version', v_version,
    'supersededId', p_source_id,
    'factsPreserved',
      public.intake_facts_fingerprint(v_soap)
        is not distinct from
      public.intake_facts_fingerprint(v_source.soap_json)
  );
end;
$$;

comment on function public.rederive_intake_interpretation(uuid, jsonb, jsonb) is
  'Re-interprets a stored intake without touching the record. Facts are read from the source row, never accepted as a parameter. Supersede + insert; the source row is never updated except for its supersession stamp.';

revoke all on function public.rederive_intake_interpretation(uuid, jsonb, jsonb) from public;
revoke all on function public.intake_facts_fingerprint(jsonb) from public;
grant execute on function public.rederive_intake_interpretation(uuid, jsonb, jsonb) to service_role;
grant execute on function public.intake_facts_fingerprint(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill the fingerprint for existing rows
-- ---------------------------------------------------------------------------
-- Provenance is deliberately NOT backfilled -- we do not know which model wrote
-- those rows and will not invent one. The fingerprint is different: it is
-- computed from data we have, and having it lets a future re-derivation of an
-- old row prove it preserved the record.
update public.intake_results
set facts_fingerprint = public.intake_facts_fingerprint(soap_json)
where facts_fingerprint is null;

-- ---------------------------------------------------------------------------
-- analyses: the live desktop path produces the same class of artifact
-- ---------------------------------------------------------------------------
-- `analyses` is upserted per session -- the running interpretation of a
-- consultation still in progress rolls forward in place. That is not the same
-- act as re-deriving a stored record, so it keeps the upsert; but the row must
-- still say which model produced what is currently in it, or the desktop's
-- output is the one clinical artifact in the system with no provenance.
alter table public.analyses
  add column if not exists interpretation_provenance jsonb not null default '{}'::jsonb;

comment on column public.analyses.interpretation_provenance is
  'Provenance of the live analysis currently stored for this session: {engine, provider, model, promptVersion, schemaVersion, generatedAt}. Same shape as intake_results.interpretation_provenance.';
