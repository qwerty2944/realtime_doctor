-- realtime_doctor -- Migration 0007: stored care activity candidates (B4).
--
-- What this is
-- ------------
-- The monthly report ("이번 달 이런 행위 기록이 N건 있었습니다") needs numbers
-- that outlive the session window they were computed in, so the candidates have
-- to be stored. B1/B2 deliberately left that open because storage creates a
-- problem the in-memory engine did not have: **rules change**, and a rule change
-- must not retroactively rewrite what a doctor was shown last month.
--
-- Still not a fee schedule. No amount, no billing code, no claim wording, and
-- no revenue estimate anywhere in this table -- the report counts records, and
-- the moment it counts money the product becomes a billing tool.
--
-- The versioning rule (this is the whole point of the table)
-- ---------------------------------------------------------
--   1. Every stored row carries the rule that produced it
--      (`engine_version` + `rule_version`) and when it was produced
--      (`generated_at`). A number with no attributable rule cannot be defended
--      in a pilot write-up, let alone in an audit.
--   2. Rows are **superseded, never mutated**. Re-scanning a consultation under
--      a newer rule inserts a new row and stamps the old one
--      `superseded_at`/`superseded_by`. The old row keeps its own quotes, its
--      own time range and its own rule_version forever.
--   3. The monthly fold groups by (activity_code, engine_version, rule_version),
--      so a rule change shows up as a *new line*, never as a silently different
--      number on an old line.
--   4. Nothing here rescans past consultations. Only the consultation currently
--      on screen is ever written, so last month's rows are not even touched by
--      a rule change -- (2) and (3) are the defence for the case where someone
--      later builds a backfill.
--
-- Only released candidates are stored
-- -----------------------------------
-- `clinical_review_status` is fixed to 'reviewed' by a CHECK. The writer is the
-- RPC below, and the app only ever feeds it the output of releaseForDisplay()
-- in src/shared/careActivities.ts -- the single door to a user-facing surface.
-- Storing unreviewed candidates would create a second door: a report is a
-- user-facing surface too, and "it was only in the report" is not a defence.
--
-- Why an RPC instead of INSERT/UPDATE grants
-- -----------------------------------------
-- Supersession is the invariant of this table, and an invariant that depends on
-- every caller remembering to do two statements in the right order is not an
-- invariant. `authenticated` therefore gets SELECT and EXECUTE only: it cannot
-- UPDATE a stored row at all, so it cannot rewrite history even for its own
-- rows, and cannot un-supersede one. (0005 had to fix exactly this shape on
-- public.devices, where a client write grant made the server-side gate
-- decorative.)
--
-- [HARD] GRANT *and* RLS, always (see 0000/0006). RLS decides which rows; GRANT
--   decides whether the role may touch the table at all. This repo has already
--   been bitten once by RLS-without-GRANT, which reads as "there is no data"
--   rather than as a failure.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- care_activity_candidates
-- ---------------------------------------------------------------------------
create table if not exists public.care_activity_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  -- The visit this recording belonged to, when one was selected. Nullable:
  -- recording without a selected patient is a normal flow.
  encounter_id uuid,

  -- Which definition fired. Text, not a FK: a definition may be retired or
  -- re-coded later and an old row must stay readable regardless.
  activity_code text not null,
  -- Label/category are **snapshotted**, not joined. If someone rewords a
  -- definition next month, last month's report must still print the wording the
  -- doctor actually saw.
  label_ko text not null,
  category text,

  -- ── provenance ─────────────────────────────────────────────────────────
  engine_version text    not null,
  rule_version   integer not null check (rule_version >= 1),
  generated_at   timestamptz not null,
  -- [HARD] Only released (clinically reviewed) candidates may be stored.
  clinical_review_status text not null default 'reviewed'
    check (clinical_review_status = 'reviewed'),

  -- ── evidence (verbatim, same shape as the in-memory candidate) ─────────
  -- [{utteranceId, quote, matchedCues, timestampMs}, ...]. The quotes are cut
  -- from the source utterance by the engine; nothing here is model-written.
  quotes        jsonb not null,
  utterance_ids text[] not null,
  start_ms          bigint  not null check (start_ms >= 0),
  end_ms            bigint  not null check (end_ms >= start_ms),
  duration_seconds  integer not null check (duration_seconds >= 0),

  -- Monthly bucket. Taken from sessions.started_at, i.e. when the consultation
  -- happened -- not when the scan ran. Re-scanning in August must not move a
  -- July consultation into August's number.
  occurred_on date not null,

  -- ── supersession (never UPDATE the payload, only stamp these two) ──────
  superseded_at timestamptz,
  -- DEFERRABLE: the replacement row must be named on the old row *before* it is
  -- inserted, because the partial unique index below only tolerates one current
  -- row per (session, activity). So the writer stamps the old row with the id it
  -- is about to insert, and the FK is checked at commit. The alternative --
  -- insert first, stamp second -- cannot pass the index at all.
  superseded_by uuid references public.care_activity_candidates (id)
    on delete set null deferrable initially deferred,

  created_at timestamptz not null default now(),

  -- A candidate with no evidence cannot exist, in memory or on disk (B2).
  constraint care_activity_candidates_quotes_nonempty
    check (jsonb_typeof(quotes) = 'array' and jsonb_array_length(quotes) >= 1),
  constraint care_activity_candidates_utterances_nonempty
    check (array_length(utterance_ids, 1) >= 1),
  -- superseded_at and superseded_by are set together, by the RPC, or not at all.
  constraint care_activity_candidates_supersede_complete
    check ((superseded_at is null) = (superseded_by is null))
);

-- At most one *current* row per (consultation, activity). Re-scanning the same
-- consultation supersedes rather than duplicating; without this a doctor who
-- opens the summary window five times would see 5x in the monthly count.
create unique index if not exists care_activity_candidates_current_uidx
  on public.care_activity_candidates (session_id, activity_code)
  where superseded_at is null;

create index if not exists care_activity_candidates_month_idx
  on public.care_activity_candidates (user_id, occurred_on)
  where superseded_at is null;

comment on table public.care_activity_candidates is
  'Care activity records evidenced by a consultation transcript (B4). Derived artefact, never part of the patient record. Not a fee schedule: no amount, no billing code, no claim wording. Rows are superseded, never mutated, so a rule change cannot rewrite an earlier month.';
comment on column public.care_activity_candidates.rule_version is
  'care_activity_defs.rule_version at generation time. The monthly fold groups by it, so a rule change appears as a new line instead of a changed number.';
comment on column public.care_activity_candidates.label_ko is
  'Snapshot of the definition label as shown to the doctor. Not joined at read time: re-wording a definition must not rewrite an old report.';
comment on column public.care_activity_candidates.occurred_on is
  'Date of sessions.started_at. The month bucket follows the consultation, not the scan.';
comment on column public.care_activity_candidates.superseded_by is
  'The row that replaced this one. Supersession is the only permitted change; the payload columns are never updated.';
comment on column public.care_activity_candidates.clinical_review_status is
  '[HARD] Fixed to reviewed by CHECK. A report is a user-facing surface, so only releaseForDisplay() output may be stored.';

-- ---------------------------------------------------------------------------
-- record_care_activity_candidates -- the only writer
-- ---------------------------------------------------------------------------
-- Takes the released candidates of one consultation and makes the stored set
-- match them, by supersede+insert. Idempotent: re-running with an unchanged
-- result touches nothing, so opening the summary window repeatedly does not
-- churn history.
--
-- SECURITY DEFINER so the client never needs a write grant, with search_path
-- pinned and ownership re-checked from auth.uid() inside.
create or replace function public.record_care_activity_candidates(
  p_session_id uuid,
  p_candidates jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid          uuid := auth.uid();
  v_started_at   timestamptz;
  v_encounter_id uuid;
  v_item         jsonb;
  v_existing     public.care_activity_candidates%rowtype;
  v_new_id       uuid;
  v_inserted     integer := 0;
  v_superseded   integer := 0;
  v_unchanged    integer := 0;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'p_candidates must be a json array' using errcode = '22023';
  end if;

  -- Ownership is re-derived from the session row, not taken from the caller.
  select s.started_at, s.encounter_id into v_started_at, v_encounter_id
  from public.sessions s
  where s.id = p_session_id and s.user_id = v_uid;
  if not found then
    raise exception 'session not found for this user' using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(p_candidates)
  loop
    -- An empty quote list is rejected by the table CHECK too; failing here
    -- gives the caller a readable error instead of a constraint name.
    if jsonb_typeof(v_item -> 'quotes') <> 'array'
       or jsonb_array_length(v_item -> 'quotes') < 1 then
      raise exception 'candidate % has no quotes', v_item ->> 'activityCode'
        using errcode = '22023';
    end if;

    select * into v_existing
    from public.care_activity_candidates c
    where c.session_id = p_session_id
      and c.activity_code = v_item ->> 'activityCode'
      and c.superseded_at is null;

    -- Same rule, same evidence, same window -> nothing happened. Leave the
    -- original row (and its generated_at) alone.
    if found
       and v_existing.engine_version = v_item ->> 'engineVersion'
       and v_existing.rule_version = (v_item ->> 'ruleVersion')::integer
       and v_existing.start_ms = (v_item ->> 'startMs')::bigint
       and v_existing.end_ms = (v_item ->> 'endMs')::bigint
       and v_existing.quotes = (v_item -> 'quotes') then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    -- Supersede first, insert second. The id is generated up front so the old
    -- row can name its replacement; the deferred self-FK makes that legal, and
    -- the partial unique index requires it (two current rows never coexist).
    v_new_id := gen_random_uuid();
    if v_existing.id is not null then
      -- Payload columns are untouched. Only the supersession stamp moves.
      update public.care_activity_candidates
      set superseded_at = now(), superseded_by = v_new_id
      where id = v_existing.id;
      v_superseded := v_superseded + 1;
    end if;

    insert into public.care_activity_candidates (
      id,
      user_id, session_id, encounter_id, activity_code, label_ko, category,
      engine_version, rule_version, generated_at,
      quotes, utterance_ids, start_ms, end_ms, duration_seconds, occurred_on
    ) values (
      v_new_id,
      v_uid, p_session_id, v_encounter_id,
      v_item ->> 'activityCode', v_item ->> 'label', nullif(v_item ->> 'category', ''),
      v_item ->> 'engineVersion', (v_item ->> 'ruleVersion')::integer,
      coalesce((v_item ->> 'generatedAt')::timestamptz, now()),
      v_item -> 'quotes',
      array(select jsonb_array_elements_text(v_item -> 'utteranceIds')),
      (v_item ->> 'startMs')::bigint,
      (v_item ->> 'endMs')::bigint,
      (v_item ->> 'durationSeconds')::integer,
      (v_started_at at time zone 'Asia/Seoul')::date
    );
    v_inserted := v_inserted + 1;
    v_existing := null;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted,
    'superseded', v_superseded,
    'unchanged', v_unchanged
  );
end;
$$;

comment on function public.record_care_activity_candidates(uuid, jsonb) is
  'Only writer for care_activity_candidates. Supersede+insert, never update-in-place, so a rule change adds a row instead of rewriting one. Idempotent for an unchanged scan.';

-- ===========================================================================
-- Privileges
-- ===========================================================================
-- SELECT own rows (report reads), EXECUTE the writer. No INSERT/UPDATE/DELETE
-- grant at all: the supersession invariant lives in the function, and a client
-- that can UPDATE can rewrite its own history.
grant select on public.care_activity_candidates to authenticated;
grant select, insert, update, delete on public.care_activity_candidates to service_role;
grant execute on function public.record_care_activity_candidates(uuid, jsonb)
  to authenticated, service_role;

alter table public.care_activity_candidates enable row level security;

drop policy if exists care_activity_candidates_select_own on public.care_activity_candidates;
create policy care_activity_candidates_select_own
  on public.care_activity_candidates for select
  to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policy on purpose: denied twice (no GRANT, no policy).
