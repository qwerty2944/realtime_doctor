-- realtime_doctor -- Migration 0019: patient-bound visit codes + walk-in intake.
--
-- Why this exists
-- ---------------
-- 0009 made "starting an intake" require a code the front desk issued. That was
-- the right access rule and it stays. What it did not give anybody was a
-- *patient*: the code is anonymous, so the person who scans it types their own
-- name into the tablet, and the desk has no way to hand a specific patient a
-- specific link ahead of time.
--
-- Two shapes are needed in a real clinic, and they are not the same shape:
--
--   (B) The invited patient. The desk registers "김OO, 010-…" and gets a link
--       that is *that patient's* link. It can be sent by KakaoTalk before the
--       visit, so the intake happens in the waiting room -- or at home -- with
--       the name already filled in. This is the path that should be default.
--
--   (A) The walk-in. A fixed QR poster on the wall of the clinic, no code at
--       all. Somebody has to be able to start an intake when the desk is busy,
--       when the phone number was wrong, when the link expired. Without a
--       fallback the desk falls back to *not using the product*.
--
-- (A) removes the code, and the code was the access control. So the fallback
-- gets its own three defences, all in this file:
--
--   1. A per-(clinician, ip) and per-clinician rate limit in the database
--      (`walk_in_intake_attempts`), same reasoning as 0009's failure counter:
--      the kiosk is serverless, so a per-process counter multiplies the
--      allowance by the instance count, silently, exactly under load.
--   2. `encounters.intake_source` records which door the visit came through, so
--      the doctor's waiting list can tell an invited patient from a stranger who
--      scanned a poster. An unmarked walk-in is worse than no walk-in: it looks
--      exactly like a patient the desk vouched for.
--   3. The walk-in path still cannot name a clinician -- the slug does that, and
--      the slug -> clinician mapping stays server-side (KIOSK_CLINICIANS).
--
-- [HARD] The walk-in door is *wider*, not open. Anyone who can read the poster
--   can create an encounter attributed to that clinic. That is the accepted
--   cost, and it is bounded by the rate limit and made visible by
--   intake_source. It is not a replacement for (B) and the UI should not present
--   it as one.
--
-- [HARD] GRANT *and* RLS, always. And `revoke ... from public` on every new
--   function before granting (0009's probe found an anon-callable SECURITY
--   DEFINER function that way; 0013 found that the revoke alone is not enough
--   because Supabase's default privileges add *named* grants too, which is why
--   every new grant below also gets an allowlist row and the 0013 guard is
--   re-run at the end of this file).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- 1) visit_access_codes: who is this code for?
-- ---------------------------------------------------------------------------
-- All three columns are nullable, because the anonymous code from 0009 still
-- exists and is still the right thing for "patient is standing here already".
-- A null patient_id means exactly that: nobody was registered, the patient will
-- type their own name.
alter table public.visit_access_codes
  add column if not exists patient_id uuid references public.patients (id) on delete set null,
  add column if not exists patient_name text,
  add column if not exists patient_phone text;

comment on column public.visit_access_codes.patient_id is
  'The pre-registered patient this code belongs to (issue_patient_visit_code). Null for anonymous codes: the patient types their own name at the kiosk. ON DELETE SET NULL rather than CASCADE -- deleting a patient must not silently delete the audit of a code that was issued.';
comment on column public.visit_access_codes.patient_name is
  'Denormalised copy of the name at issue time, so the kiosk can prefill without reading `patients` and so the issuing dialog can list outstanding invitations after the patient row changed.';
comment on column public.visit_access_codes.patient_phone is
  'Phone the invitation was (or can be) sent to. Kept here rather than read from `patients` at send time so the notification cannot follow a later edit to a different number.';

create index if not exists visit_access_codes_patient_idx
  on public.visit_access_codes (patient_id)
  where patient_id is not null;

-- ---------------------------------------------------------------------------
-- 2) encounters.intake_source -- which door did this visit come through?
-- ---------------------------------------------------------------------------
-- Default 'invite' and not 'unknown': every row that exists before this
-- migration was created by redeeming a front-desk code, which is exactly what
-- 'invite' means. Backfilling them as 'unknown' would invent doubt about rows we
-- are certain of.
alter table public.encounters
  add column if not exists intake_source text not null default 'invite';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'encounters_intake_source_check'
      and conrelid = 'public.encounters'::regclass
  ) then
    alter table public.encounters
      add constraint encounters_intake_source_check
      check (intake_source in ('invite', 'walk_in'));
  end if;
end;
$$;

comment on column public.encounters.intake_source is
  'invite = started by redeeming a code the front desk issued (0009/0019). walk_in = started from the in-clinic QR with no code. The doctor must be able to tell these apart: nobody vouched for a walk-in.';

create index if not exists encounters_intake_source_idx
  on public.encounters (user_id, intake_source);

-- ---------------------------------------------------------------------------
-- 3) Tunables for the new paths
-- ---------------------------------------------------------------------------
-- An invitation is sent *before* the visit -- by KakaoTalk, the evening before,
-- to somebody who will read it when they wake up. 30 minutes (0009's TTL, which
-- was sized for "walk from the desk to the tablet") would make that link dead on
-- arrival, and a dead link in a patient's message history is worse than no
-- message: they blame themselves and stop trying.
create or replace function public.visit_code_patient_ttl_seconds()
returns integer language sql immutable as $$ select 86400 $$;

-- Upper bound for the patient-bound issuer. Two days covers "sent the evening
-- before" plus a missed morning appointment; past that the desk should reissue,
-- because a live credential that outlives the visit it was for is just a live
-- credential.
create or replace function public.visit_code_patient_max_ttl_seconds()
returns integer language sql immutable as $$ select 172800 $$;

-- Walk-in rate limit. The window is 10 minutes rather than 1 because starting an
-- intake is not a guess that can be retried in a tight loop -- the cost we are
-- bounding is a human (or a script) creating junk encounters, and a per-minute
-- window with a usable allowance adds up to a lot per hour.
create or replace function public.walk_in_window_minutes()
returns integer language sql immutable as $$ select 10 $$;

-- Per source address. A family sharing a phone hotspot in the waiting room is
-- real, so this is not 1.
create or replace function public.walk_in_max_per_ip()
returns integer language sql immutable as $$ select 5 $$;

-- Per clinic, across all addresses. Bounds a distributed attempt, and it is well
-- above any real waiting room's rate.
create or replace function public.walk_in_max_per_clinician()
returns integer language sql immutable as $$ select 40 $$;

-- ---------------------------------------------------------------------------
-- 4) issue_patient_visit_code -- called by the desktop app (authenticated)
-- ---------------------------------------------------------------------------
-- Creates the patient row *and* the code in one transaction, and returns the
-- plaintext code exactly once (0009's rule: the plaintext is never stored).
--
-- [HARD] Always a new patient row. No lookup by (name, phone).
--   Reusing a matching existing patient sounds tidier and is the more dangerous
--   default: two different people named 김영수 with no phone on file would be
--   merged into one chart, and a merged chart is not a mistake anybody notices
--   from the waiting list. Duplicates are visible and fixable; a wrong merge is
--   neither. Deduplication is a decision for a screen where a human can see both
--   records, not for an issuing function that sees one name.
create or replace function public.issue_patient_visit_code(
  p_kiosk_slug text default null,
  p_patient_name text default null,
  p_patient_phone text default null,
  p_ttl_seconds integer default null
) returns jsonb
language plpgsql
security definer
-- `extensions` is on the search_path because Supabase installs pgcrypto there;
-- see the same note on issue_visit_access_code (0009).
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_alphabet text := public.visit_code_alphabet();
  v_len integer := public.visit_code_length();
  v_ttl integer := coalesce(p_ttl_seconds, public.visit_code_patient_ttl_seconds());
  v_slug text := nullif(lower(trim(coalesce(p_kiosk_slug, ''))), '');
  v_name text := nullif(trim(coalesce(p_patient_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_patient_phone, ''), '[^0-9+]', '', 'g'), '');
  v_code text := '';
  v_salt bytea;
  v_byte integer;
  v_live integer;
  v_expires timestamptz;
  v_patient_id uuid;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- The name is the entire point of this function: a code with no patient is
  -- issue_visit_access_code, which still exists. Refusing here rather than
  -- falling back keeps the two paths from quietly becoming one.
  if v_name is null then
    raise exception 'patient name is required' using errcode = '22023';
  end if;
  if length(v_name) > 60 then
    raise exception 'patient name is too long' using errcode = '22023';
  end if;

  -- Phone is optional (an invitation can be handed over as a QR on the screen).
  -- When present it must look like a phone number, because the only thing we do
  -- with it is send a message to it.
  --
  -- [HARD] "Typed something unusable" is not the same as "left it blank".
  --   Stripping punctuation can empty the field entirely (someone typed a note
  --   instead of a number). Treating that as "no phone" would be a silent
  --   failure of exactly the kind this repo keeps finding: the desk gets no
  --   error, the send button simply never appears, and nobody knows why.
  if nullif(trim(coalesce(p_patient_phone, '')), '') is not null
     and (v_phone is null or v_phone !~ '^\+?[0-9]{9,15}$') then
    raise exception 'invalid phone number' using errcode = '22023';
  end if;

  if v_ttl < 60 or v_ttl > public.visit_code_patient_max_ttl_seconds() then
    raise exception 'ttl out of range: % seconds', v_ttl using errcode = '22023';
  end if;

  if v_slug is not null and v_slug !~ '^[a-z0-9][a-z0-9_-]{0,30}$' then
    raise exception 'invalid kiosk slug' using errcode = '22023';
  end if;

  -- Housekeeping first (0009): dead codes must not fill the live quota.
  delete from public.visit_access_codes
  where user_id = v_uid
    and expires_at < now() - interval '1 day';
  delete from public.visit_access_code_attempts
  where minute_bucket < now() - interval '1 day';

  select count(*) into v_live
  from public.visit_access_codes
  where user_id = v_uid
    and consumed_at is null
    and expires_at > now();

  if v_live >= public.visit_code_max_live() then
    raise exception 'too many unused visit codes are still live (%). Wait for them to expire.', v_live
      using errcode = '53400';
  end if;

  -- Same rejection sampling as 0009. Duplicated deliberately rather than
  -- extracted: a shared generator would have to be a SECURITY DEFINER function
  -- of its own with its own grants, and the loop is five lines.
  while length(v_code) < v_len loop
    v_byte := get_byte(gen_random_bytes(1), 0);
    if v_byte < 234 then
      v_code := v_code || substr(v_alphabet, (v_byte % 26) + 1, 1);
    end if;
  end loop;

  insert into public.patients (user_id, name, phone)
  values (v_uid, v_name, v_phone)
  returning id into v_patient_id;

  v_salt := gen_random_bytes(16);
  v_expires := now() + make_interval(secs => v_ttl);

  insert into public.visit_access_codes (
    user_id, kiosk_slug, code_salt, code_hash, issued_by, expires_at,
    patient_id, patient_name, patient_phone
  ) values (
    v_uid, v_slug, v_salt, digest(v_salt || convert_to(v_code, 'UTF8'), 'sha256'), v_uid, v_expires,
    v_patient_id, v_name, v_phone
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'kioskSlug', v_slug,
    'expiresAt', v_expires,
    'ttlSeconds', v_ttl,
    'patientId', v_patient_id,
    'patientName', v_name,
    'patientPhone', v_phone
  );
end;
$$;

comment on function public.issue_patient_visit_code(text, text, text, integer) is
  'Registers a patient and issues a visit code bound to them, returning the plaintext code exactly once. Always creates a new patient row -- see the [HARD] note in migration 0019 on why it never reuses a matching one.';

-- ---------------------------------------------------------------------------
-- 5) redeem_visit_access_code -- same signature, two more fields returned
-- ---------------------------------------------------------------------------
-- Replaced rather than versioned. The argument list is byte-identical to 0009's,
-- so every existing caller keeps working and the 0013 allowlist entry (matched
-- by regprocedure) keeps matching. A v2 alongside v1 would mean two copies of an
-- authorisation decision, which is how you get a deployment where only one of
-- them was fixed -- the exact thing 0009 refused to do for the check-only path.
--
-- The additions are `patientId` and `patientName`. The kiosk uses the first to
-- attach the encounter to the already-registered patient (instead of creating a
-- second row for the same person) and the second to prefill the name field.
create or replace function public.redeem_visit_access_code(
  p_clinician_id uuid,
  p_code text,
  p_kiosk_slug text default null,
  p_consume boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_norm text := public.normalize_visit_code(p_code);
  v_slug text := nullif(lower(trim(coalesce(p_kiosk_slug, ''))), '');
  v_bucket timestamptz := date_trunc('minute', now());
  v_failures integer;
  v_row public.visit_access_codes%rowtype;
  v_match public.visit_access_codes%rowtype;
  v_status text;
  v_mode text;
  v_over_limit boolean;
  v_updated public.visit_access_codes%rowtype;
begin
  if p_clinician_id is null then
    raise exception 'clinician id is required' using errcode = '22023';
  end if;

  -- [HARD] The limit gates *failures*, never a correct code. See 0009 for the
  -- full argument: refusing everything once the bucket is full turns the rate
  -- limiter into a denial-of-service lever against real patients.
  select failures into v_failures
  from public.visit_access_code_attempts
  where user_id = p_clinician_id and minute_bucket = v_bucket;

  v_over_limit := coalesce(v_failures, 0) >= public.visit_code_max_failures_per_minute();

  if length(v_norm) <> public.visit_code_length() then
    if v_over_limit then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    perform public.record_visit_code_failure(p_clinician_id, v_bucket);
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  for v_row in
    select *
    from public.visit_access_codes
    where user_id = p_clinician_id
      and expires_at > now()
  loop
    if v_row.code_hash = digest(v_row.code_salt || convert_to(v_norm, 'UTF8'), 'sha256') then
      v_match := v_row;
      exit;
    end if;
  end loop;

  if v_match.id is null then
    if v_over_limit then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    perform public.record_visit_code_failure(p_clinician_id, v_bucket);
    if exists (
      select 1 from public.visit_access_codes
      where user_id = p_clinician_id
        and expires_at <= now()
        and code_hash = digest(code_salt || convert_to(v_norm, 'UTF8'), 'sha256')
    ) then
      return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  if v_match.kiosk_slug is not null and v_match.kiosk_slug is distinct from v_slug then
    if v_over_limit then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    perform public.record_visit_code_failure(p_clinician_id, v_bucket);
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  if v_match.consumed_at is null then
    v_mode := 'created';
  else
    if v_match.redeem_count >= public.visit_code_max_redeems() then
      return jsonb_build_object('ok', false, 'reason', 'exhausted');
    end if;

    if v_match.encounter_id is null then
      v_mode := 'created';
    else
      select e.status into v_status
      from public.encounters e
      where e.id = v_match.encounter_id;

      if v_status is distinct from 'intake_in_progress' then
        return jsonb_build_object('ok', false, 'reason', 'consumed');
      end if;
      v_mode := 'resumed';
    end if;
  end if;

  if not p_consume then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'checkOnly', true,
      'codeId', null,
      'clinicianId', v_match.user_id,
      'encounterId', v_match.encounter_id,
      'redeemCount', v_match.redeem_count,
      'patientId', v_match.patient_id,
      'patientName', v_match.patient_name
    );
  end if;

  update public.visit_access_codes
  set consumed_at = coalesce(consumed_at, now()),
      redeem_count = redeem_count + 1,
      last_redeemed_at = now()
  where id = v_match.id
    and redeem_count = v_match.redeem_count
    and (consumed_at is null) = (v_match.consumed_at is null)
  returning * into v_updated;

  if v_updated.id is null then
    return jsonb_build_object('ok', false, 'reason', 'consumed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'codeId', v_updated.id,
    'clinicianId', v_updated.user_id,
    'encounterId', v_updated.encounter_id,
    'redeemCount', v_updated.redeem_count,
    'patientId', v_updated.patient_id,
    'patientName', v_updated.patient_name
  );
end;
$$;

comment on function public.redeem_visit_access_code(uuid, text, text, boolean) is
  'Consumes a per-visit access code. service_role only. Returns created/resumed plus the pre-registered patient (0019), or a failure reason; a finished intake makes its code permanently unusable.';

-- ---------------------------------------------------------------------------
-- 6) Walk-in rate limiter
-- ---------------------------------------------------------------------------
-- One row per (clinician, source, minute). `ip_hash` is a hash, not an address:
-- the kiosk HMACs the client IP with KIOSK_TOKEN_SECRET before it gets here. We
-- need to tell two sources apart; we do not need to know who they are, and an
-- IP list sitting next to a table of medical encounters is a liability with no
-- corresponding use.
create table if not exists public.walk_in_intake_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  ip_hash text not null,
  minute_bucket timestamptz not null,
  starts integer not null default 0 check (starts >= 0),
  primary key (user_id, ip_hash, minute_bucket)
);

comment on table public.walk_in_intake_attempts is
  'Rate-limiter state for code-less (walk-in) intake starts. One row per clinician per source hash per minute; counted in the database because the kiosk is serverless and a per-process counter multiplies the allowance by the instance count.';
comment on column public.walk_in_intake_attempts.ip_hash is
  'HMAC of the client address, computed by the kiosk. Never the address itself.';

create index if not exists walk_in_intake_attempts_bucket_idx
  on public.walk_in_intake_attempts (minute_bucket);

-- Returns { "allowed": bool, "reason": "ok"|"ip"|"clinician", "perIp": int,
--           "perClinician": int }.
--
-- [HARD] It counts *before* it decides, and it records the attempt either way.
--   A limiter that only counts the attempts it let through cannot see a flood.
--   And, like 0009's failure counter, it returns its refusal instead of raising
--   it -- a raised exception would roll the counter back together with the
--   attack.
create or replace function public.record_walk_in_intake_start(
  p_clinician_id uuid,
  p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_bucket timestamptz := date_trunc('minute', now());
  v_since timestamptz := now() - make_interval(mins => public.walk_in_window_minutes());
  v_hash text := nullif(trim(coalesce(p_ip_hash, '')), '');
  v_per_ip integer;
  v_per_clinician integer;
begin
  if p_clinician_id is null then
    raise exception 'clinician id is required' using errcode = '22023';
  end if;

  -- No usable source hash: everything lands in one bucket, which is the safe
  -- direction (it makes the per-source limit stricter, never looser).
  if v_hash is null then
    v_hash := 'unknown';
  end if;

  delete from public.walk_in_intake_attempts
  where minute_bucket < now() - interval '1 day';

  insert into public.walk_in_intake_attempts (user_id, ip_hash, minute_bucket, starts)
  values (p_clinician_id, v_hash, v_bucket, 1)
  on conflict (user_id, ip_hash, minute_bucket)
    do update set starts = public.walk_in_intake_attempts.starts + 1;

  select coalesce(sum(starts), 0) into v_per_ip
  from public.walk_in_intake_attempts
  where user_id = p_clinician_id and ip_hash = v_hash and minute_bucket >= v_since;

  select coalesce(sum(starts), 0) into v_per_clinician
  from public.walk_in_intake_attempts
  where user_id = p_clinician_id and minute_bucket >= v_since;

  if v_per_ip > public.walk_in_max_per_ip() then
    return jsonb_build_object('allowed', false, 'reason', 'ip',
      'perIp', v_per_ip, 'perClinician', v_per_clinician);
  end if;

  if v_per_clinician > public.walk_in_max_per_clinician() then
    return jsonb_build_object('allowed', false, 'reason', 'clinician',
      'perIp', v_per_ip, 'perClinician', v_per_clinician);
  end if;

  return jsonb_build_object('allowed', true, 'reason', 'ok',
    'perIp', v_per_ip, 'perClinician', v_per_clinician);
end;
$$;

comment on function public.record_walk_in_intake_start(uuid, text) is
  'Counts and rules on one code-less intake start. service_role only. Records the attempt whether or not it is allowed.';

-- ===========================================================================
-- Privileges
-- ===========================================================================
-- [HARD] Revoke from PUBLIC before granting. Postgres grants EXECUTE on a new
--   function to PUBLIC by default, and these are SECURITY DEFINER.
revoke all on function public.issue_patient_visit_code(text, text, text, integer) from public;
revoke all on function public.redeem_visit_access_code(uuid, text, text, boolean) from public;
revoke all on function public.record_walk_in_intake_start(uuid, text) from public;
revoke all on function public.visit_code_patient_ttl_seconds() from public;
revoke all on function public.visit_code_patient_max_ttl_seconds() from public;
revoke all on function public.walk_in_window_minutes() from public;
revoke all on function public.walk_in_max_per_ip() from public;
revoke all on function public.walk_in_max_per_clinician() from public;

-- The desktop app issues; the kiosk server redeems. Nothing changes about who
-- may do which -- `anon` appears nowhere, and the tunables are not granted to
-- `authenticated` at all (0013 removed the equivalent 0009 grants because no
-- client reads them).
grant execute on function public.issue_patient_visit_code(text, text, text, integer) to authenticated, service_role;
grant execute on function public.redeem_visit_access_code(uuid, text, text, boolean) to service_role;
grant execute on function public.record_walk_in_intake_start(uuid, text) to service_role;
grant execute on function public.visit_code_patient_ttl_seconds() to service_role;
grant execute on function public.visit_code_patient_max_ttl_seconds() to service_role;
grant execute on function public.walk_in_window_minutes() to service_role;
grant execute on function public.walk_in_max_per_ip() to service_role;
grant execute on function public.walk_in_max_per_clinician() to service_role;

grant select, insert, update, delete on public.walk_in_intake_attempts to service_role;

alter table public.walk_in_intake_attempts enable row level security;
-- No policy and no GRANT for authenticated: like visit_access_code_attempts,
-- this counter is infrastructure. Letting a client read it tells whoever is
-- probing how much budget is left in the window.

-- ---------------------------------------------------------------------------
-- Allowlist (0013) -- one row per privilege a *named client role* holds
-- ---------------------------------------------------------------------------
-- Only `authenticated` needs an entry: everything else here is service_role,
-- which the guard does not police. Inserted, not re-seeded -- 0013's `delete
-- from` belongs to 0013.
insert into public.role_privilege_allowlist
  (object_kind, object_name, grantee, privilege, rationale)
values
  ('function', 'public.issue_patient_visit_code(text, text, text, integer)', 'authenticated', 'EXECUTE',
   'src/main/visitCodes.ts -- supabase.rpc(''issue_patient_visit_code'', ...). The front desk registers a patient and gets that patient''s link. Redemption is a different function and stays service_role-only.')
on conflict do nothing;

-- ===========================================================================
-- Guard (0013's, re-run against the live catalogue)
-- ===========================================================================
-- Re-run here for the same reason 0017 re-runs it: a checked list rots. If this
-- migration (or Supabase's default privileges reacting to it) hands anything to
-- anon/authenticated/PUBLIC that the allowlist does not name, this fails now
-- rather than being found by an audit months later.
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

-- Self-check: the kiosk server must be able to reach everything this migration
-- created. Asserted here so a dropped grant fails the migration instead of
-- failing a patient standing in front of the poster.
do $$
declare
  v_missing text;
begin
  select string_agg(x.what, ', ' order by x.what)
  into v_missing
  from (
    select 'relation public.walk_in_intake_attempts' as what
    where not has_table_privilege('service_role', 'public.walk_in_intake_attempts', 'INSERT')

    union all

    select 'function ' || f as what
    from unnest(array[
      'public.record_walk_in_intake_start(uuid, text)',
      'public.redeem_visit_access_code(uuid, text, text, boolean)'
    ]) as f
    where not has_function_privilege('service_role', f, 'EXECUTE')

    union all

    select 'function public.issue_patient_visit_code(text, text, text, integer) for authenticated' as what
    where not has_function_privilege('authenticated', 'public.issue_patient_visit_code(text, text, text, integer)', 'EXECUTE')
  ) x;

  if v_missing is not null then
    raise exception 'objects 0019 created are unreachable by their intended callers: %', v_missing;
  end if;
end;
$$;
