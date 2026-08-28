-- realtime_doctor -- Migration 0006: care activity definitions (B1).
--
-- What this is
-- ------------
-- A catalogue of *care activities that a consultation transcript can evidence*.
-- It is deliberately NOT a fee schedule and NOT a billing code table. The
-- product surface this feeds says "이런 행위 기록이 있습니다", never
-- "청구하세요" -- suggesting a claim is the line that turns a detection tool
-- into 부당청구 방조, and the 삭감 / 현지실사 exposure lands on the doctor, not
-- on us. Every identifier here is therefore named after the *act* (care
-- activity), not after the money, because identifiers leak into UI and logs.
--
-- Why the definitions live in data and not in code
-- ------------------------------------------------
-- We do not yet know which acts actually leak in a Korean clinic, in which
-- specialty, or which ones carry 삭감 risk -- that is domain knowledge we have
-- not been given. Hard-coding a guess would mean a release for every correction
-- once we do get it. So the whole rule (which words, which speaker, how long,
-- what negates it) is columns on this table, and the detection engine
-- (src/shared/careActivities.ts) contains no item-specific knowledge at all.
-- Adding or fixing an item is a CSV edit plus `node scripts/load-care-activities.mjs`.
--
-- [HARD] Nothing seeded here reaches a doctor unreviewed.
--   clinical_review_status starts at 'unreviewed' and only service_role can
--   change it (authenticated has SELECT only -- see the GRANT block). The
--   engine still evaluates unreviewed definitions so that a reviewer can see
--   what a rule would produce, but releaseForDisplay() in
--   src/shared/careActivities.ts refuses to hand an unreviewed candidate to a
--   user-facing surface, and the released type carries the literal
--   'reviewed' so an unreviewed one cannot even be constructed as that type.
--
-- [HARD] GRANT *and* RLS, always (see 0000). RLS decides which rows; GRANT
--   decides whether the role may touch the table at all. A previous migration
--   in this repo enabled RLS without GRANT and every read came back empty,
--   which reads as "there is no data" rather than as a failure.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- care_activity_defs
-- ---------------------------------------------------------------------------
create table if not exists public.care_activity_defs (
  id   uuid primary key default gen_random_uuid(),
  -- Stable English identifier used by code and probes. Named after the act
  -- ("lifestyle_education"), never after a billing code -- an identifier that
  -- says "claim" will eventually be rendered somewhere.
  code text not null unique,

  -- User-facing Korean text. Phrased as an observation of what happened, in
  -- the past tense of a record: "생활습관 교육 대화". The loader script rejects
  -- any row whose label or description contains 청구/수가/급여 wording.
  label_ko       text not null,
  description_ko text not null default '',

  -- Free-form grouping, e.g. '교육상담', '처치'. Not constrained: we do not
  -- know the real taxonomy yet and a wrong CHECK would block data entry.
  category  text,
  -- Which specialty this definition was written for. NULL = not specialty
  -- specific. Kept because 새는 항목 differs by 진료과.
  specialty text,

  -- ── detection rule (all data, no code) ─────────────────────────────────
  -- Substrings looked for in an utterance, after whitespace normalisation.
  -- A definition with no cues can never fire (enforced by the CHECK below):
  -- an empty rule that matches everything is the worst possible failure here.
  cue_terms text[] not null,
  -- Words that cancel a cue hit inside the same utterance -- "다음에
  -- 설명드릴게요", "안 했", "하지 않았". Cheap, and it removes the most common
  -- false positive class: talking *about* an act instead of performing it.
  negation_terms text[] not null default '{}',
  -- Which speaker must have said the cue. 'any' is allowed but discouraged for
  -- acts the doctor performs.
  required_speaker text not null default 'any'
    check (required_speaker in ('doctor', 'patient', 'any')),
  -- How many *distinct* cue terms must appear before a candidate exists.
  -- Default 2: one passing mention of a keyword is not evidence that the act
  -- was performed, and this is the main dial that biases us toward false
  -- negatives.
  min_distinct_cues smallint not null default 2 check (min_distinct_cues >= 1),
  -- How many utterances must carry cues. Same purpose as above, on a different
  -- axis: one long sentence containing two keywords is still one mention.
  min_utterances smallint not null default 2 check (min_utterances >= 1),
  -- Minimum elapsed time between the first and last cue-bearing utterance,
  -- from real chunk timestamps. 0 disables the check. This is what separates
  -- "8분간 교육했다" from "교육 얘기가 잠깐 나왔다".
  min_duration_seconds integer not null default 0 check (min_duration_seconds >= 0),

  -- ── clinical review gate ───────────────────────────────────────────────
  clinical_review_status text not null default 'unreviewed'
    check (clinical_review_status in ('unreviewed', 'reviewed', 'retired')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  -- enabled=false hides a definition from the engine entirely. Retiring is
  -- done by flag, never by DELETE: a candidate produced last month must stay
  -- explainable.
  enabled      boolean not null default true,
  -- Bumped when the rule changes. Carried into every candidate's provenance so
  -- an old detection can be attributed to the rule that actually made it.
  rule_version integer not null default 1 check (rule_version >= 1),
  source_label text not null default '내부 정의 (임상 검토 전)',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- A definition with no cue terms would match on the strength of its duration
-- rule alone, i.e. on nothing. Reject it at the storage layer.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.care_activity_defs'::regclass
      and conname = 'care_activity_defs_cue_terms_nonempty'
  ) then
    alter table public.care_activity_defs
      add constraint care_activity_defs_cue_terms_nonempty
      check (array_length(cue_terms, 1) >= 1);
  end if;

  -- min_distinct_cues can never be satisfiable if it exceeds the cue list.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.care_activity_defs'::regclass
      and conname = 'care_activity_defs_cues_satisfiable'
  ) then
    alter table public.care_activity_defs
      add constraint care_activity_defs_cues_satisfiable
      check (min_distinct_cues <= array_length(cue_terms, 1));
  end if;

  -- A row cannot claim review without saying when it was reviewed.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.care_activity_defs'::regclass
      and conname = 'care_activity_defs_review_complete'
  ) then
    alter table public.care_activity_defs
      add constraint care_activity_defs_review_complete
      check (clinical_review_status <> 'reviewed' or reviewed_at is not null);
  end if;
end;
$$;

comment on table public.care_activity_defs is
  'Definitions of care activities a consultation transcript can evidence (B1). Not a fee schedule: no amount, no billing code, no claim wording. Rules are data so a non-programmer can add items without a release.';
comment on column public.care_activity_defs.code is
  'Stable English identifier. Named after the act, never after a billing code -- identifiers leak into UI.';
comment on column public.care_activity_defs.cue_terms is
  'Substrings searched in normalised utterance text. Quotes shown to the doctor are cut from the source utterance, never from this list.';
comment on column public.care_activity_defs.min_distinct_cues is
  'Conservatism dial. Default 2: a single keyword mention is not evidence an act was performed.';
comment on column public.care_activity_defs.min_duration_seconds is
  'Elapsed seconds between first and last cue utterance, measured from real transcript_chunks.timestamp_ms. Never a model estimate.';
comment on column public.care_activity_defs.clinical_review_status is
  '[HARD] unreviewed rows must not reach a doctor-facing surface. Only service_role can promote to reviewed; the client has SELECT only.';
comment on column public.care_activity_defs.enabled is
  'Retire by flag, never by DELETE: a candidate produced last month must stay explainable.';

create index if not exists care_activity_defs_active_idx
  on public.care_activity_defs (enabled, clinical_review_status);

create or replace function public.touch_care_activity_defs()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists care_activity_defs_touch on public.care_activity_defs;
create trigger care_activity_defs_touch
  before update on public.care_activity_defs
  for each row execute function public.touch_care_activity_defs();

-- ===========================================================================
-- Privileges
-- ===========================================================================
-- Shared catalogue, not PHI: any signed-in clinician may read it.
--
-- Writes are service_role only, and that is the review gate's integrity. If
-- `authenticated` could UPDATE, the committed anon-flow client could promote
-- its own unreviewed rows to 'reviewed' and walk straight past the gate -- the
-- exact failure 0005 had to fix on public.devices.
grant select on public.care_activity_defs to authenticated;
grant select, insert, update, delete on public.care_activity_defs to service_role;

alter table public.care_activity_defs enable row level security;

drop policy if exists care_activity_defs_select_authenticated on public.care_activity_defs;
create policy care_activity_defs_select_authenticated
  on public.care_activity_defs for select
  to authenticated
  using (enabled);

-- No policy for insert/update/delete at all: service_role bypasses RLS, every
-- other role is denied by the absence of both a GRANT and a policy.
