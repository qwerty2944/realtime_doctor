-- realtime_doctor -- Migration 0018: one stored shape for a differential
-- diagnosis, enforced by the database rather than by convention.
--
-- Why
-- ---
-- `intake_results.differentials_json` carried the diagnosis name under
-- different keys depending on who wrote it. The kiosk wrote `name_kr`/`name_en`
-- and required both. The desktop analyzer's own JSON schema uses
-- `name`/`nameEn`. And the desktop reader
-- (`src/renderer/shared/patientMode.ts`) probed five spellings in order:
--
--     pickText(row, 'name_kr', 'nameKr', 'name', 'name_en', 'nameEn')
--
-- Code that knows about a fork is evidence the fork was routed around, not
-- closed. Nothing in the system said which spelling was correct, so nothing
-- could reject a wrong one.
--
-- Why it is worth a constraint and not just a comment
-- ---------------------------------------------------
--   1. `f_web_stats_diagnosis` (0014) is live and aggregates by
--      `differentials_json -> 0 ->> 'name_kr'`. A camelCase row does not error
--      there -- it falls into the '미분류' bucket. Silently. The clinician sees
--      a plausible chart with the wrong numbers in it.
--   2. `rederive_intake_interpretation` (0011) exists to re-derive stored
--      interpretations when the model changes, and has no caller yet. It takes
--      `p_interpretation -> 'differentials'` and writes it into
--      `differentials_json` verbatim. The day it is wired to the desktop
--      analyzer's output shape it rewrites rows **in bulk** in the other
--      spelling -- a latent inconsistency becomes a mass mis-aggregation,
--      found months later as "why did the diagnosis stats collapse in March".
--
-- A TypeScript type cannot defend against (2), because (2) is a SQL path. The
-- check has to live here.
--
-- What the canonical shape is
-- ---------------------------
--   [{"rank":int,"name_kr":text,"name_en":text,"rationale":text,
--     "supporting_findings":[{"finding":text,"source":text}]}]
--
-- snake_case, because every other stored JSON in this schema is snake_case
-- (`soap_json` uses s/o/a/p, `follow_up_questions`, `medical_terms`;
-- `recommended_tests_json` uses `name_kr`/`name_en`). And because it is what
-- 100% of the existing rows already are -- measured, not assumed: at the time
-- this migration was written production held 8 rows / 24 differential items,
-- all of them `name_kr` + `name_en`, zero in any other spelling. There is no
-- backfill in this file because there is nothing to backfill.
--
-- Why `analyses.differential_diagnoses` is NOT changed to match
-- -------------------------------------------------------------
-- It is a different artefact, not the same artefact spelled differently:
--   - it is the running interpretation of a consultation still in progress,
--     upserted in place every few seconds; `intake_results` is an immutable
--     versioned record;
--   - it has no `rank` (order is array position and it is recomputed on every
--     pass) and it does have `icd10`;
--   - its `name` follows the consultation language. For an English encounter
--     there IS no Korean diagnosis name, so a `name_kr` key there would be a
--     field that has to be filled with a lie;
--   - no reader benefits: `f_web_stats_diagnosis` does not aggregate it and
--     `patientMode.ts` does not read it.
-- Renaming it would be a migration with a cost and no beneficiary. What this
-- file does instead is stop the two shapes leaking into each other: each column
-- gets a constraint naming its own shape, so a writer that confuses them is
-- rejected at the point of the write instead of discovered in a chart.
--
-- The TypeScript side of the same decision lives in `src/shared/differentials.ts`
-- (`INTAKE_DIFFERENTIAL_KEYS`, `LIVE_ANALYSIS_DIFFERENTIAL_KEYS`,
-- `toIntakeDifferentials`). `scripts/probe-differentials-shape.mjs` fails the
-- build if that file and this one stop agreeing.

-- ---------------------------------------------------------------------------
-- 1) intake_results.differentials_json
-- ---------------------------------------------------------------------------
-- Expressed as jsonpath rather than a helper function on purpose. A CHECK
-- constraint may not contain a subquery, and a helper function would need an
-- EXECUTE grant for every role that inserts -- which is exactly the kind of
-- PUBLIC EXECUTE that 0013's audit exists to forbid. `jsonb_path_exists` is
-- immutable and needs no privilege of its own.
--
-- Four things are rejected:
--   a. a non-array, or an element that is not an object;
--   b. a missing / non-string / blank `name_kr`;
--   c. a missing / non-string / blank `name_en`;
--   d. ANY key outside the canonical five.
--
-- (d) is the part that matters most. A denylist of the four wrong spellings we
-- happen to know about does not stop a future writer inventing a fifth one; an
-- allowlist of the five right ones does. `nameKr`, `name`, `nameEn` and a
-- not-yet-imagined `dx_name` all fail the same way, for the same reason.
--
-- An empty array passes: that is the column default, and a row with no
-- differentials is a real state (the kiosk writes the row before the model has
-- produced anything).
alter table public.intake_results
  drop constraint if exists intake_results_differentials_canonical;

alter table public.intake_results
  add constraint intake_results_differentials_canonical check (
    jsonb_typeof(differentials_json) = 'array'
    and not jsonb_path_exists(differentials_json,
          '$[*] ? (@.type() != "object")')
    and not jsonb_path_exists(differentials_json,
          '$[*] ? (!(@.name_kr.type() == "string") || @.name_kr like_regex "^\\s*$")')
    and not jsonb_path_exists(differentials_json,
          '$[*] ? (!(@.name_en.type() == "string") || @.name_en like_regex "^\\s*$")')
    and not jsonb_path_exists(differentials_json,
          '$[*].keyvalue() ? (!(@.key == "rank" || @.key == "name_kr" || @.key == "name_en" || @.key == "rationale" || @.key == "supporting_findings"))')
  );

comment on column public.intake_results.differentials_json is
  'CANONICAL SHAPE, enforced by intake_results_differentials_canonical. Ordered array (index 0 = highest priority): [{"rank":int,"name_kr":text,"name_en":text,"rationale":text,"supporting_findings":[{"finding":text,"source":text}]}]. name_kr and name_en are both required and non-blank; no other key is permitted. camelCase (name/nameEn/nameKr) is rejected -- that is the shape of analyses.differential_diagnoses, a different artefact. Cross into this shape via toIntakeDifferentials() in src/shared/differentials.ts.';

-- ---------------------------------------------------------------------------
-- 2) analyses.differential_diagnoses -- the other side of the same boundary
-- ---------------------------------------------------------------------------
-- Deliberately weaker than (1). This column is upserted by the desktop on every
-- analysis pass and carries optional fields (`icd10`, `references` from the
-- PubMed lookup) that come and go, so a key allowlist here would break live
-- saves for no gain. What it does enforce is the one thing that would actually
-- be a drift: the name lives under `name`, and the snake_case spellings that
-- belong to `intake_results` are not accepted here.
alter table public.analyses
  drop constraint if exists analyses_differentials_camel_shape;

alter table public.analyses
  add constraint analyses_differentials_camel_shape check (
    jsonb_typeof(differential_diagnoses) = 'array'
    and not jsonb_path_exists(differential_diagnoses,
          '$[*] ? (!(@.name.type() == "string") || @.name like_regex "^\\s*$")')
    and not jsonb_path_exists(differential_diagnoses,
          '$[*] ? (exists(@.name_kr) || exists(@.name_en) || exists(@.nameKr))')
  );

comment on column public.analyses.differential_diagnoses is
  'CANONICAL SHAPE for the live desktop path, enforced by analyses_differentials_camel_shape: [{"name":text,"nameEn":text,"icd10":text,"reasoning":text,"supportingFindings":[{"finding":text,"source":text,"utteranceId":text,"quote":text}]}]. camelCase on purpose -- see the header of 0018 and LIVE_ANALYSIS_DIFFERENTIAL_KEYS in src/shared/differentials.ts. snake_case name keys are rejected: those belong to intake_results.differentials_json.';

-- ---------------------------------------------------------------------------
-- 3) rederive_intake_interpretation -- say so at the door
-- ---------------------------------------------------------------------------
-- The constraint above already stops a camelCase re-derivation from landing.
-- What it cannot do is explain itself: the caller would see a constraint
-- violation naming a column and have to work out why. This raises first, with
-- the reason and the fix in the message. Behaviour is otherwise byte-identical
-- to 0011 -- the facts still come from the source row, the supersede+insert is
-- unchanged, the fingerprint is still recomputed.
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
  v_diffs      jsonb;
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

  -- [0018] The differential list is the one part of an interpretation that has
  -- a stored spelling other code aggregates by. Reject the wrong shape here,
  -- named, instead of letting the table constraint report it as an anonymous
  -- violation on a bulk re-derivation that has already run 400 times.
  v_diffs := coalesce(p_interpretation -> 'differentials', v_source.differentials_json);
  if jsonb_typeof(v_diffs) <> 'array' then
    raise exception 'differentials must be a json array' using errcode = '22023';
  end if;
  if jsonb_path_exists(v_diffs,
       '$[*].keyvalue() ? (@.key == "name" || @.key == "nameEn" || @.key == "nameKr")') then
    raise exception
      'differentials use the live-analysis shape (name/nameEn). intake_results.differentials_json is snake_case: name_kr/name_en. Convert with toIntakeDifferentials() in src/shared/differentials.ts.'
      using errcode = '22023';
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
    v_diffs,
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
  'Re-interprets a stored intake without touching the record. Facts are read from the source row, never accepted as a parameter. Supersede + insert; the source row is never updated except for its supersession stamp. Since 0018 it also rejects a differential list written in the live-analysis (camelCase) shape.';

-- `create or replace` preserves grants, but restating them makes this file
-- self-contained if it is ever applied to a database built from a subset.
revoke all on function public.rederive_intake_interpretation(uuid, jsonb, jsonb) from public;
grant execute on function public.rederive_intake_interpretation(uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 4) f_web_stats_diagnosis (0014) is deliberately left alone
-- ---------------------------------------------------------------------------
-- It reads `name_kr` first, `name_en` second, '미분류' last -- which already
-- matches the canonical shape chosen here, so the live numbers do not move.
-- The change is that its fallbacks are now unreachable for new rows rather
-- than being the thing standing between a camelCase writer and a wrong chart.
-- Rewriting a live SECURITY DEFINER aggregate to no behavioural end would be a
-- worse trade than leaving it: it is covered by 0013's allowlist and 0017's
-- probe, and every re-creation is a chance to change something by accident.
