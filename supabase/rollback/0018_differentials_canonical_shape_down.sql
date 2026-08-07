-- realtime_doctor -- Rollback of 0018_differentials_canonical_shape.sql.
--
-- Drops the two CHECK constraints and restores the pre-0018 column comments and
-- the 0011 body of `rederive_intake_interpretation`. No data is touched: 0018
-- writes no rows and backfills nothing, because every existing row already
-- conformed (8 rows / 24 items, all name_kr + name_en) -- so there is no data
-- change to undo.
--
-- What is lost by running this: nothing about the stored data, everything about
-- the guarantee. After this file, a writer can put camelCase back into
-- `intake_results.differentials_json` and `f_web_stats_diagnosis` will bucket
-- it as '미분류' without erroring.

alter table public.intake_results
  drop constraint if exists intake_results_differentials_canonical;

alter table public.analyses
  drop constraint if exists analyses_differentials_camel_shape;

comment on column public.intake_results.differentials_json is
  'Ordered array (index 0 = highest priority): [{"rank":int,"name_kr":text,"name_en":text,"rationale":text}]';

comment on column public.analyses.differential_diagnoses is null;

-- Restore the 0011 body verbatim (no v_diffs pre-check).
create or replace function public.rederive_intake_interpretation(
  p_source_id     uuid,
  p_interpretation jsonb,
  p_provenance     jsonb
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

  v_soap := jsonb_build_object(
    's',          coalesce(v_source.soap_json -> 's', '{}'::jsonb),
    'transcript', coalesce(v_source.soap_json -> 'transcript', '[]'::jsonb)
  );

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
grant execute on function public.rederive_intake_interpretation(uuid, jsonb, jsonb) to service_role;
