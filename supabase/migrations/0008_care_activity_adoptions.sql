-- realtime_doctor -- Migration 0008: per-clinician adoption of care activity
-- definitions (B5).
--
-- Why this table has to exist
-- --------------------------
-- 0006 put the clinical review gate on the definition row itself
-- (`care_activity_defs.clinical_review_status`). The definitions are **shared
-- templates**: every account reads the same catalogue. So a single flip of that
-- column turns detection on for *everyone who uses the product*. One
-- clinician's clinical judgement would silently start producing records in
-- another clinic, on another specialty, with vocabulary that clinician never
-- looked at. That is not a modelling nicety -- it is the same class of failure
-- as 0005's client-writable `devices`: an authorisation decision landing on
-- rows that do not belong to the decider.
--
-- The fix is to separate the two questions that column was answering at once:
--
--   1. "Is this template fit to be offered at all?"  -> stays on
--      care_activity_defs (vendor side, service_role only). 'retired' is still
--      a global kill switch; see the note below for what 'reviewed' now means.
--   2. "Has *this* clinician taken responsibility for this rule, at this exact
--      rule_version?"                                 -> this table, one row
--      per (user, activity), written only by the user it belongs to.
--
-- [HARD] What `care_activity_defs.clinical_review_status` means from 0008 on
--   'reviewed' on the shared row **no longer enables detection for anybody**.
--   It is kept because it is the vendor's own record of which templates were
--   vetted before shipping, and because dropping a column that older rows and
--   older probes reference would rewrite history for no gain. The only value
--   that still has global force is 'retired', which withdraws a template from
--   everyone -- a kill switch may be global; an enable must not be.
--   The effective status a doctor sees is computed per user in
--   src/shared/careActivities.ts (resolveReviewStatus) and nowhere else.
--
-- [HARD] Review is bound to a rule_version.
--   An adoption records *which rule* was approved. When the rule changes
--   (rule_version bumps), the adoption stops matching and the definition falls
--   back to unreviewed for that clinician -- the same rule the CSV loader
--   already follows ("a review of the old rule is not a review of the new
--   one"). Nothing is deleted; the clinician simply has to look at the new rule.
--
-- [HARD] Un-review must not destroy evidence.
--   Revoking sets `revoked_at` and leaves `reviewed_at` / `reviewed_by` intact.
--   Stored candidates in care_activity_candidates are never touched: what a
--   doctor was shown last month stays true and stays countable. Revocation
--   stops *future* detection, which is the only thing it should stop.
--
-- [HARD] GRANT *and* RLS, always (see 0000/0006/0007).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- care_activity_adoptions
-- ---------------------------------------------------------------------------
create table if not exists public.care_activity_adoptions (
  id uuid primary key default gen_random_uuid(),
  -- The clinician this decision belongs to. Everything in this table is scoped
  -- by it; there is deliberately no way to express "reviewed for everyone".
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Which template. FK on the definition's stable code, not on its uuid: the
  -- code is what humans, the CSV and the probes use, and definitions are
  -- retired by flag rather than deleted.
  activity_code text not null
    references public.care_activity_defs (code) on update cascade on delete cascade,

  -- The rule_version that was actually read and approved. If the definition
  -- moves past this number the adoption no longer applies.
  reviewed_rule_version integer not null check (reviewed_rule_version >= 1),

  -- Who took clinical responsibility, and when. Recorded from auth.uid() inside
  -- the RPC, never from the client payload.
  reviewed_by uuid not null references auth.users (id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  review_note text,

  -- Non-null = withdrawn. The review columns above are left as they were: the
  -- fact that someone once approved this rule is part of the record.
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint care_activity_adoptions_revoke_complete
    check ((revoked_at is null) = (revoked_by is null))
);

-- One decision row per (clinician, activity). Re-reviewing updates it in place;
-- the history that matters (what was approved, by whom, when it was withdrawn)
-- lives in the columns.
create unique index if not exists care_activity_adoptions_user_code_uidx
  on public.care_activity_adoptions (user_id, activity_code);

create index if not exists care_activity_adoptions_active_idx
  on public.care_activity_adoptions (user_id)
  where revoked_at is null;

comment on table public.care_activity_adoptions is
  'Per-clinician adoption of a shared care activity definition (B5). Review state is never global: one clinician approving a template must not enable detection in another clinic.';
comment on column public.care_activity_adoptions.reviewed_rule_version is
  'The rule_version that was read and approved. A later rule_version invalidates the adoption -- a review of the old rule is not a review of the new one.';
comment on column public.care_activity_adoptions.revoked_at is
  'Withdrawal stamp. Stops future detection only; reviewed_at/reviewed_by and every stored candidate are left untouched.';

create or replace function public.touch_care_activity_adoptions()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists care_activity_adoptions_touch on public.care_activity_adoptions;
create trigger care_activity_adoptions_touch
  before update on public.care_activity_adoptions
  for each row execute function public.touch_care_activity_adoptions();

-- The shared column's meaning changed; say so where a reader will find it.
comment on column public.care_activity_defs.clinical_review_status is
  '[HARD] From 0008 on, ''reviewed'' here enables nothing for anyone -- it is the vendor''s own vetting record. Detection is gated per clinician by public.care_activity_adoptions. ''retired'' remains a global kill switch.';

-- ---------------------------------------------------------------------------
-- set_care_activity_adoption -- the only writer
-- ---------------------------------------------------------------------------
-- Approve or withdraw one definition for the calling clinician.
--
-- p_rule_version is the version the reviewer actually had on screen. If the
-- definition has moved on since the dialog was opened, the call is rejected
-- rather than silently approving a rule nobody read -- the whole point of
-- review is that the approved text and the running rule are the same text.
--
-- SECURITY DEFINER so the client never needs a write grant on the table, with
-- search_path pinned and the owner taken from auth.uid() inside.
create or replace function public.set_care_activity_adoption(
  p_activity_code text,
  p_rule_version integer,
  p_reviewed boolean,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_def public.care_activity_defs%rowtype;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into v_def
  from public.care_activity_defs d
  where d.code = p_activity_code;
  if not found then
    raise exception 'unknown care activity definition: %', p_activity_code
      using errcode = '22023';
  end if;

  if p_reviewed then
    if not v_def.enabled or v_def.clinical_review_status = 'retired' then
      raise exception 'definition % is withdrawn and cannot be approved', p_activity_code
        using errcode = '22023';
    end if;
    if p_rule_version is distinct from v_def.rule_version then
      raise exception
        'rule version mismatch for %: reviewer saw v%, current is v%',
        p_activity_code, p_rule_version, v_def.rule_version
        using errcode = '22023';
    end if;

    insert into public.care_activity_adoptions (
      user_id, activity_code, reviewed_rule_version,
      reviewed_by, reviewed_at, review_note, revoked_at, revoked_by
    ) values (
      v_uid, p_activity_code, v_def.rule_version,
      v_uid, now(), nullif(p_note, ''), null, null
    )
    on conflict (user_id, activity_code) do update
      set reviewed_rule_version = excluded.reviewed_rule_version,
          reviewed_by           = excluded.reviewed_by,
          reviewed_at           = excluded.reviewed_at,
          review_note           = excluded.review_note,
          revoked_at            = null,
          revoked_by            = null;
  else
    -- Withdrawal. No row means nothing to withdraw, which is not an error --
    -- the caller's intent ("this must not be active for me") already holds.
    update public.care_activity_adoptions
    set revoked_at = now(), revoked_by = v_uid
    where user_id = v_uid
      and activity_code = p_activity_code
      and revoked_at is null;
  end if;

  return (
    select jsonb_build_object(
      'activityCode', a.activity_code,
      'reviewedRuleVersion', a.reviewed_rule_version,
      'reviewedAt', a.reviewed_at,
      'reviewedBy', a.reviewed_by,
      'reviewNote', a.review_note,
      'revokedAt', a.revoked_at
    )
    from public.care_activity_adoptions a
    where a.user_id = v_uid and a.activity_code = p_activity_code
  );
end;
$$;

comment on function public.set_care_activity_adoption(text, integer, boolean, text) is
  'Only writer for care_activity_adoptions. Scoped to auth.uid(); rejects approval of a rule_version other than the one currently stored, so nobody approves text they did not read.';

-- ===========================================================================
-- Privileges
-- ===========================================================================
-- SELECT own rows (the reviewer screen and the detection loader read them),
-- EXECUTE the writer. No INSERT/UPDATE/DELETE grant: a client that could write
-- this table directly could set reviewed_by to someone else, keep an adoption
-- alive across a rule change, or -- with a forged user_id -- approve on another
-- clinician's behalf, which is the exact failure this migration exists to stop.
grant select on public.care_activity_adoptions to authenticated;
grant select, insert, update, delete on public.care_activity_adoptions to service_role;
grant execute on function public.set_care_activity_adoption(text, integer, boolean, text)
  to authenticated, service_role;

alter table public.care_activity_adoptions enable row level security;

drop policy if exists care_activity_adoptions_select_own on public.care_activity_adoptions;
create policy care_activity_adoptions_select_own
  on public.care_activity_adoptions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policy on purpose: denied twice (no GRANT, no policy).
