-- realtime_doctor -- Migration 0009: per-visit access codes for the intake kiosk (L1).
--
-- Why this exists
-- ---------------
-- M6 designed the kiosk slug (`/intake?k=main`) as "a routing key, not a
-- secret", and said so out loud. That was correct while the kiosk was
-- unpublished. It stops being correct the moment the kiosk serves from a public
-- address: anyone who knows the URL can start an intake, and the result is an
-- `encounters` row attributed to a real, named clinician. A medical
-- conversation an AI had with someone the doctor never met would be recorded
-- under that doctor's name and land in their waiting list. In the liability
-- framework (tasks/architecture-and-liability.md sec.4) that is a failure of
-- operational-scope control, on the component with the weakest human oversight.
--
-- From here on, starting an intake requires a code that a human at the front
-- desk issued for this visit. The slug still routes; it is no longer sufficient.
--
-- The code format, and why
-- -----------------------
--   7 characters from a 26-symbol alphabet: 23456789ACDEFGHJKMNPRTVWXY
--
--   * The alphabet drops every pair that gets confused when a code is read
--     aloud across a desk or typed by an elderly patient: 0/O, 1/I/L, 2/Z, 5/S,
--     8/B, U/V, O/Q. What is left cannot be mis-transcribed into another valid
--     symbol -- a wrong character is a *rejected* character, not a different
--     valid code.
--   * 26^7 = 8.03e9 (~2^33). Short enough to read out in two breaths
--     (grouped 4-3 for display), large enough that the rate limit below turns
--     guessing into a non-event.
--   * Codes are generated from gen_random_bytes(), not random(). random() is a
--     seeded PRNG: observing a few codes would predict the rest, which is
--     exactly the attack this table is supposed to stop. Rejection sampling
--     removes the modulo bias (256 is not a multiple of 26).
--
-- TTL: 30 minutes (VISIT_CODE_DEFAULT_TTL_SECONDS below). A code is handed over
-- and walked to a tablet in the same room; 30 minutes covers a slow walk and a
-- queue without leaving a live credential lying on a desk after the patient has
-- gone home.
--
-- Why brute force is impractical at 7 characters
-- ---------------------------------------------
-- A short code is guessable unless something bounds the number of guesses and
-- the number of live targets. Three bounds, all enforced here rather than in
-- application code:
--
--   1. Rate limit. `visit_access_code_attempts` counts *failed* redemptions per
--      clinician per minute and the redeem function refuses past
--      VISIT_CODE_MAX_FAILURES_PER_MINUTE (20). An attacker has to name a
--      clinician (via the kiosk slug) to attack one, so per-clinician is the
--      unit that matters -- there is no way to spread guesses across the
--      keyspace faster by rotating slugs.
--   2. Live-target cap. Issuance refuses when a clinician already has
--      VISIT_CODE_MAX_LIVE (50) unexpired unused codes. Without this, the
--      probability per guess grows with clinic volume.
--   3. TTL. A guess only wins against a code that is still live.
--
--   => p(one guess hits) <= 50 / 8.03e9 = 6.2e-9.
--      20 guesses/min = 1.05e7 guesses/year.
--      Expected successful guesses: ~6.5e-5 per clinician per year, i.e. once
--      per ~15,000 years of continuous attack, while the attempt table records
--      every minute of it.
--
-- Storage: the plaintext code is never stored
-- ------------------------------------------
-- Each row keeps a random 16-byte salt and sha256(salt || code). Redemption
-- scans the (small) set of live codes for that one clinician and hashes the
-- presented code once per row -- a few dozen sha256 calls, cheap, and no
-- deterministic hash that a stolen dump could look up in a rainbow table.
--
-- Honesty about the limit: 2^33 is small enough that a *dump of this table*
-- would let an attacker brute-force an individual row offline. That is accepted
-- because (a) any dump that reaches this table also reaches `encounters`, which
-- is the PHI the code protects, so the code is no longer the weak link, and
-- (b) a recovered code is worthless 30 minutes after issuance. The hashing is
-- defence against incidental exposure (logs, backups, a careless SELECT), not
-- against total compromise.
--
-- [HARD] No unissued access creates a row.
--   Redemption happens before the kiosk writes `patients` or `encounters` and
--   before it calls the model. See kiosk/app/api/intake/start/route.ts.
--
-- [HARD] GRANT *and* RLS, always (see 0000/0006/0007/0008). RLS decides which
--   rows; GRANT decides whether the role may touch the table at all. This repo
--   has already been bitten by RLS-without-GRANT, which reads as "there is no
--   data" rather than as a failure.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- visit_access_codes
-- ---------------------------------------------------------------------------
create table if not exists public.visit_access_codes (
  id uuid primary key default gen_random_uuid(),

  -- The clinician this visit belongs to. The kiosk resolves its slug to this
  -- uuid server-side and will only look at codes carrying it, so a code issued
  -- by one clinic can never start an intake attributed to another.
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Optional narrowing to one kiosk of that clinician. Null = any of their
  -- kiosks. Null is the default because most clinics have one tablet and an
  -- extra field to get wrong is an extra way to hand a patient a code that
  -- silently does not work.
  kiosk_slug text
    check (kiosk_slug is null or kiosk_slug ~ '^[a-z0-9][a-z0-9_-]{0,30}$'),

  -- sha256(code_salt || code). The plaintext is returned to the issuer exactly
  -- once, by the issuing function, and never written anywhere.
  code_salt bytea not null check (octet_length(code_salt) = 16),
  code_hash bytea not null check (octet_length(code_hash) = 32),

  issued_by uuid not null references auth.users (id) on delete restrict,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,

  -- First successful redemption. Non-null = spent.
  consumed_at timestamptz,
  -- The one encounter this code created. A code is bound to a single visit;
  -- see the resume rule on redeem_visit_access_code.
  encounter_id uuid references public.encounters (id) on delete set null,
  redeem_count integer not null default 0 check (redeem_count >= 0),
  last_redeemed_at timestamptz,

  created_at timestamptz not null default now(),

  constraint visit_access_codes_expiry_after_issue check (expires_at > issued_at)
);

comment on table public.visit_access_codes is
  'Single-use, short-lived per-visit access codes issued at the front desk (L1). Holding one is required to start a kiosk intake; the kiosk slug alone is not sufficient. Plaintext codes are never stored.';
comment on column public.visit_access_codes.user_id is
  'Owning clinician. encounters.user_id is taken from the kiosk slug resolution and must equal this, so a code cannot start an intake attributed to another doctor.';
comment on column public.visit_access_codes.encounter_id is
  'The single encounter this code created. Set once; a code that already produced a finished intake can never produce another.';
comment on column public.visit_access_codes.redeem_count is
  'Total redemptions including resumes of the same unfinished encounter. Capped so a leaked code cannot be replayed into unbounded model calls.';

-- Redemption scans live codes for one clinician; this is the index it uses.
create index if not exists visit_access_codes_live_idx
  on public.visit_access_codes (user_id, expires_at desc);
create index if not exists visit_access_codes_encounter_idx
  on public.visit_access_codes (encounter_id)
  where encounter_id is not null;

-- ---------------------------------------------------------------------------
-- visit_access_code_attempts -- the rate limiter
-- ---------------------------------------------------------------------------
-- One row per (clinician, minute). Counting failures in the database rather
-- than in the Next.js process is deliberate: the kiosk may run on several
-- serverless instances, and a per-process counter would multiply the allowance
-- by the number of instances -- silently, and exactly under load.
create table if not exists public.visit_access_code_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  minute_bucket timestamptz not null,
  failures integer not null default 0 check (failures >= 0),
  primary key (user_id, minute_bucket)
);

comment on table public.visit_access_code_attempts is
  'Failed redemption counter, one row per clinician per minute. Bounds brute force against the 7-character code; see the header of migration 0009.';

create index if not exists visit_access_code_attempts_bucket_idx
  on public.visit_access_code_attempts (minute_bucket);

-- ---------------------------------------------------------------------------
-- Tunables. Kept as functions so the numbers have exactly one home and the
-- probe can read the same values the server enforces.
-- ---------------------------------------------------------------------------
create or replace function public.visit_code_alphabet()
returns text language sql immutable as $$ select '23456789ACDEFGHJKMNPRTVWXY' $$;

create or replace function public.visit_code_length()
returns integer language sql immutable as $$ select 7 $$;

create or replace function public.visit_code_default_ttl_seconds()
returns integer language sql immutable as $$ select 1800 $$;

create or replace function public.visit_code_max_live()
returns integer language sql immutable as $$ select 50 $$;

create or replace function public.visit_code_max_failures_per_minute()
returns integer language sql immutable as $$ select 20 $$;

-- Redeems allowed on one code: the first (which creates the encounter) plus two
-- resumes of that same unfinished encounter. See the abandonment rule below.
create or replace function public.visit_code_max_redeems()
returns integer language sql immutable as $$ select 3 $$;

-- ---------------------------------------------------------------------------
-- Normalisation -- one implementation, used by issue and redeem alike
-- ---------------------------------------------------------------------------
-- Uppercases and drops anything that is not in the alphabet (spaces, the
-- display hyphen, a stray dot). Characters outside the alphabet are dropped
-- rather than mapped: every confusable glyph pair had *both* members removed
-- from the alphabet, so there is no correct target to map an 'O' or an 'I' to,
-- and guessing one would let a mistyped code silently become a different valid
-- code.
create or replace function public.normalize_visit_code(p_code text)
returns text
language sql
immutable
as $$
  select regexp_replace(
    upper(coalesce(p_code, '')),
    '[^' || public.visit_code_alphabet() || ']',
    '',
    'g'
  )
$$;

comment on function public.normalize_visit_code(text) is
  'Canonical form of a typed code: uppercase, alphabet characters only. Used by both issuance and redemption so the two can never disagree.';

-- ---------------------------------------------------------------------------
-- issue_visit_access_code -- called by the desktop app (authenticated)
-- ---------------------------------------------------------------------------
-- Returns the plaintext code once. It is not stored and cannot be recovered: if
-- the dialog is closed before the patient reads it, issue another one.
create or replace function public.issue_visit_access_code(
  p_kiosk_slug text default null,
  p_ttl_seconds integer default null
) returns jsonb
language plpgsql
security definer
-- `extensions` is in the search_path because Supabase installs pgcrypto there,
-- and a SECURITY DEFINER function with a pinned search_path would otherwise not
-- see gen_random_bytes()/digest() at all.
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_alphabet text := public.visit_code_alphabet();
  v_len integer := public.visit_code_length();
  v_ttl integer := coalesce(p_ttl_seconds, public.visit_code_default_ttl_seconds());
  v_slug text := nullif(lower(trim(coalesce(p_kiosk_slug, ''))), '');
  v_code text := '';
  v_salt bytea;
  v_byte integer;
  v_live integer;
  v_expires timestamptz;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- A TTL the caller picks is still a TTL we have to defend. 1 minute to
  -- 2 hours; past that the code stops being "for this visit".
  if v_ttl < 60 or v_ttl > 7200 then
    raise exception 'ttl out of range: % seconds', v_ttl using errcode = '22023';
  end if;

  if v_slug is not null and v_slug !~ '^[a-z0-9][a-z0-9_-]{0,30}$' then
    raise exception 'invalid kiosk slug' using errcode = '22023';
  end if;

  -- Housekeeping first, so an old backlog of dead codes cannot fill the live
  -- quota. Deleting rather than keeping: an expired code has no evidentiary
  -- value (the encounter it produced carries its own record), and keeping
  -- hashes of dead credentials around is a liability, not an audit trail.
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

  -- Bounds the number of simultaneously guessable targets. Hitting this means
  -- codes are being issued and not used, which is a workflow problem worth
  -- surfacing rather than absorbing.
  if v_live >= public.visit_code_max_live() then
    raise exception 'too many unused visit codes are still live (%). Wait for them to expire.', v_live
      using errcode = '53400';
  end if;

  -- Rejection sampling over gen_random_bytes: accept a byte only below the
  -- largest multiple of the alphabet size (26 * 9 = 234), so every symbol is
  -- equally likely. Taking `byte % 26` unconditionally would make the first
  -- four symbols ~12% more likely than the rest.
  while length(v_code) < v_len loop
    v_byte := get_byte(gen_random_bytes(1), 0);
    if v_byte < 234 then
      v_code := v_code || substr(v_alphabet, (v_byte % 26) + 1, 1);
    end if;
  end loop;

  v_salt := gen_random_bytes(16);
  v_expires := now() + make_interval(secs => v_ttl);

  insert into public.visit_access_codes (
    user_id, kiosk_slug, code_salt, code_hash, issued_by, expires_at
  ) values (
    v_uid, v_slug, v_salt, digest(v_salt || convert_to(v_code, 'UTF8'), 'sha256'), v_uid, v_expires
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'kioskSlug', v_slug,
    'expiresAt', v_expires,
    'ttlSeconds', v_ttl
  );
end;
$$;

comment on function public.issue_visit_access_code(text, integer) is
  'Issues one per-visit access code for the calling clinician and returns the plaintext exactly once. The plaintext is never stored.';

-- ---------------------------------------------------------------------------
-- redeem_visit_access_code -- called by the kiosk server only (service_role)
-- ---------------------------------------------------------------------------
-- The clinician id is passed in because the kiosk, not the database, owns the
-- slug -> clinician mapping (KIOSK_CLINICIANS). Passing it is safe precisely
-- because only service_role may call this: an anonymous browser cannot reach
-- the function at all, so it cannot name a clinician.
--
-- Return shape (jsonb):
--   { "ok": true,  "mode": "created"|"resumed", "codeId": uuid,
--     "clinicianId": uuid, "encounterId": uuid|null, "redeemCount": int }
--   { "ok": false, "reason": "unknown"|"expired"|"consumed"|"exhausted"|"rate_limited" }
--
-- Abandonment rule
-- ----------------
-- A code is consumed the first time it is used, and that use is bound to the
-- encounter it created. If the patient walks away mid-intake -- or the tablet
-- reloads, which is the same thing from the server's side -- the *same* code
-- may be presented again and returns "resumed" with the same encounter, while
-- two conditions hold: the code has not expired, and its encounter is still
-- `intake_in_progress`.
--
-- Why not simply refuse: refusing sends the patient back to the front desk for
-- a browser refresh, and every re-issue creates a second `encounters` row for
-- one visit -- duplicate patients in the waiting list is the failure mode the
-- doctor actually pays for. Why this is not a replay hole: resuming creates
-- nothing. It cannot produce a second encounter, and the moment the intake
-- finishes (status leaves `intake_in_progress`) the code is dead permanently,
-- so a code recovered afterwards buys nothing. The redeem cap
-- (visit_code_max_redeems) bounds how much model work a leaked, still-open code
-- can cause.
--
-- p_consume = false: the "is this code any good?" check
-- ----------------------------------------------------
-- The kiosk asks the patient for the code on the first screen, before consent
-- and before any personal details, so a mistyped code is caught in the one
-- place where the patient can still fix it -- not after they have filled in
-- their name and date of birth. That check needs the same matching, the same
-- slug rule and the same rate limiter as the real thing, and it must not
-- consume anything.
--
-- It is therefore the *same function* with the final UPDATE skipped, and not a
-- second implementation. Two copies of an authorisation decision is how you get
-- a deployment where one of them was fixed. Skipping the UPDATE is the only
-- difference; a failing check still costs the attacker a slot in the minute
-- bucket, so the brute-force arithmetic in the header is unchanged.
-- The 3-argument shape from an earlier draft of this migration would survive a
-- `create or replace` as a separate overload and make every call ambiguous.
drop function if exists public.redeem_visit_access_code(uuid, text, text);

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

  -- How many failures this clinician has already collected this minute. Read
  -- now, acted on below.
  --
  -- [HARD] The limit gates *failures*, never a correct code.
  --   The obvious shape -- refuse everything once the bucket is full -- turns
  --   the rate limiter into a denial-of-service lever: anyone who can reach the
  --   kiosk could keep one clinic's minute bucket permanently full and stop
  --   real patients, holding real codes, from starting an intake. The probe
  --   found exactly that (a legitimate QR scan was refused right after 30 wrong
  --   guesses).
  --   So the match runs first and a code that actually matches is honoured no
  --   matter how full the bucket is. Only the failure paths consult the limit.
  --   An attacker is guessing, so every one of their attempts is a failure and
  --   every one of them is capped -- the brute-force arithmetic in the header is
  --   unchanged, and they learn nothing from the refusal because a wrong code
  --   and a rate-limited wrong code are both simply "not accepted".
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

  -- Scan this clinician's codes that could still matter. Per-row salts rule out
  -- an indexed lookup by hash, which is the point of the salts; the set is
  -- bounded by visit_code_max_live() plus whatever is still resumable, so this
  -- is a few dozen sha256 calls.
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
    -- A miss. This is the path an attacker is on, so the limit applies here.
    if v_over_limit then
      return jsonb_build_object('ok', false, 'reason', 'rate_limited');
    end if;
    -- Could be a wrong code or an expired one. Only the caller who already
    -- holds a code learns which: confirming that a code once existed narrows
    -- the keyspace for whoever is guessing, so the log keeps the distinction
    -- and the patient-facing wording stays close.
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

  -- A code pinned to one kiosk must be presented at that kiosk.
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
      -- Consumed but never bound: the kiosk died between redemption and the
      -- insert. Nothing was created, so let this visit start properly instead
      -- of stranding the patient with a burnt code and no encounter.
      v_mode := 'created';
    else
      select e.status into v_status
      from public.encounters e
      where e.id = v_match.encounter_id;

      -- Finished (or vanished) intake: permanently spent. This is the
      -- anti-replay rule.
      if v_status is distinct from 'intake_in_progress' then
        return jsonb_build_object('ok', false, 'reason', 'consumed');
      end if;
      v_mode := 'resumed';
    end if;
  end if;

  -- Check-only caller: report what would happen and touch nothing.
  if not p_consume then
    return jsonb_build_object(
      'ok', true,
      'mode', v_mode,
      'checkOnly', true,
      'codeId', null,
      'clinicianId', v_match.user_id,
      'encounterId', v_match.encounter_id,
      'redeemCount', v_match.redeem_count
    );
  end if;

  -- Atomic consume. The guard repeats the conditions above so two tablets
  -- presenting the same code at the same instant cannot both come back
  -- "created": the loser's UPDATE matches zero rows.
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
    'redeemCount', v_updated.redeem_count
  );
end;
$$;

comment on function public.redeem_visit_access_code(uuid, text, text, boolean) is
  'Consumes a per-visit access code. service_role only. Returns created/resumed, or a failure reason; a finished intake makes its code permanently unusable.';

-- Split out only so the four failure paths above share one implementation.
-- It runs inside the redeeming transaction, which is fine because redeem
-- *returns* its failures rather than raising them -- a raised exception would
-- roll the counter back together with the attack, and a rate limiter that
-- unwinds with the attacker is not a rate limiter. That is why every failure
-- path in redeem_visit_access_code returns jsonb and none of them raise.
create or replace function public.record_visit_code_failure(
  p_clinician_id uuid,
  p_bucket timestamptz
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  insert into public.visit_access_code_attempts (user_id, minute_bucket, failures)
  values (p_clinician_id, p_bucket, 1)
  on conflict (user_id, minute_bucket)
    do update set failures = public.visit_access_code_attempts.failures + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- bind_visit_access_code_encounter -- close the loop after the insert
-- ---------------------------------------------------------------------------
-- Called by the kiosk immediately after it creates the encounter. Binding is
-- write-once: if the row already names an encounter, this is a no-op, so a
-- second call can never re-point a spent code at a fresh visit.
create or replace function public.bind_visit_access_code_encounter(
  p_code_id uuid,
  p_encounter_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_ok boolean := false;
begin
  update public.visit_access_codes c
  set encounter_id = p_encounter_id
  where c.id = p_code_id
    and c.encounter_id is null
    and exists (
      select 1 from public.encounters e
      where e.id = p_encounter_id and e.user_id = c.user_id
    )
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

comment on function public.bind_visit_access_code_encounter(uuid, uuid) is
  'Binds a redeemed code to the encounter it created. Write-once; refuses to bind an encounter belonging to another clinician.';

-- ===========================================================================
-- Privileges
-- ===========================================================================
-- `authenticated` (the desktop app) may read its own codes so the issuing
-- dialog can show what is outstanding, and may EXECUTE the issuer. It gets no
-- INSERT/UPDATE/DELETE: a client that could write this table could mint a code
-- for itself with any expiry, or -- with a forged user_id -- mint one that
-- starts an intake in someone else's name, which is the exact failure this
-- migration exists to prevent (the same shape as 0005's client-writable
-- `devices`).
--
-- `anon` appears nowhere. Patients never authenticate against the database;
-- every kiosk write goes through the kiosk's server-side routes on service_role.
-- Redemption is service_role-only for the same reason: the browser must not be
-- able to name a clinician and start guessing.
grant select on public.visit_access_codes to authenticated;
grant select, insert, update, delete on public.visit_access_codes to service_role;
grant select, insert, update, delete on public.visit_access_code_attempts to service_role;

-- [HARD] Revoke from PUBLIC first.
--   Postgres grants EXECUTE on a new function to PUBLIC by default. Granting to
--   service_role therefore adds nothing and hides nothing: without these
--   revokes, `anon` -- an unauthenticated browser -- could call
--   redeem_visit_access_code() directly, name any clinician it liked, and burn
--   or guess their codes with no server in the way. The probe caught this
--   (HTTP 200 for both anon and a signed-in stranger).
--   These functions are SECURITY DEFINER, so a stray PUBLIC grant is not a
--   small mistake; it hands out the definer's privileges.
revoke all on function public.issue_visit_access_code(text, integer) from public;
revoke all on function public.redeem_visit_access_code(uuid, text, text, boolean) from public;
revoke all on function public.bind_visit_access_code_encounter(uuid, uuid) from public;
revoke all on function public.record_visit_code_failure(uuid, timestamptz) from public;

grant execute on function public.issue_visit_access_code(text, integer) to authenticated, service_role;
grant execute on function public.redeem_visit_access_code(uuid, text, text, boolean) to service_role;
grant execute on function public.bind_visit_access_code_encounter(uuid, uuid) to service_role;
grant execute on function public.record_visit_code_failure(uuid, timestamptz) to service_role;
grant execute on function public.normalize_visit_code(text) to authenticated, service_role;
grant execute on function public.visit_code_alphabet() to authenticated, service_role;
grant execute on function public.visit_code_length() to authenticated, service_role;
grant execute on function public.visit_code_default_ttl_seconds() to authenticated, service_role;
grant execute on function public.visit_code_max_live() to authenticated, service_role;
grant execute on function public.visit_code_max_failures_per_minute() to authenticated, service_role;
grant execute on function public.visit_code_max_redeems() to authenticated, service_role;

alter table public.visit_access_codes enable row level security;
alter table public.visit_access_code_attempts enable row level security;

drop policy if exists visit_access_codes_select_own on public.visit_access_codes;
create policy visit_access_codes_select_own
  on public.visit_access_codes for select
  to authenticated
  using (user_id = (select auth.uid()));

-- No policy at all on visit_access_code_attempts for authenticated, and no
-- GRANT either: the counter is infrastructure, and letting a client read it
-- tells an attacker how much budget is left this minute.

-- No insert/update/delete policy on visit_access_codes on purpose: denied twice
-- (no GRANT, no policy).
