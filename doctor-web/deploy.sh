#!/usr/bin/env bash
#
# Production deploy for the RightHand doctor statistics dashboard (doctor-web).
#
# Idempotent: re-running it is safe. Environment variables already present on the
# Vercel project are left alone (their values are not printed or overwritten), and
# only missing ones are added. Pass --force-env to replace them instead, which is
# what you want after rotating a key.
#
# Usage:
#   ./deploy.sh              deploy, adding any missing environment variables
#   ./deploy.sh --force-env  remove and re-add every managed variable, then deploy
#   ./deploy.sh --env-only   sync environment variables and stop, without deploying
#
# Written for bash 3.2, which is what macOS ships. No associative arrays, no `wait -n`.
#
# Scope note: this app is ONE surface, /righthand/doctor/*. Patient intake moved to
# `kiosk/` and is not deployed by this script; the recording and consultation
# features live in the Electron app under `src/`. The three variables below are the
# complete set the code reads — see .env.example.

set -euo pipefail

# --- Locations ---------------------------------------------------------------
# Resolved relative to this script so it works from any working directory. The
# script now sits inside the app it deploys (it used to sit one level above, in
# the standalone righthand_voice repo).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${SCRIPT_DIR}"
LOCAL_ENV_FILE="${APP_DIR}/.env.local"

# Custom domain attached to the Vercel production deployment. Every deploy also
# gets a unique *.vercel.app URL, but that one changes on each build -- links we
# hand to people, and the Supabase Site URL, must use the stable domain.
CANONICAL_URL="https://entanglecare.com"

# The Supabase project this dashboard reads: the native app's LIVE production
# database. The web's own former project (iqrkfqtifjanseoknkpq) has been deleted.
SUPABASE_PROJECT_REF="yhwvwojjwwlcrvpfxgag"

# The Vercel CLI is installed under ~/.hermes and is not on PATH. Prefer that path,
# fall back to whatever is on PATH, so the script keeps working if it moves.
VERCEL_BIN="${VERCEL_BIN:-/Users/seungwoolee/.hermes/node/bin/vercel}"
if [ ! -x "${VERCEL_BIN}" ]; then
  if command -v vercel >/dev/null 2>&1; then
    VERCEL_BIN="$(command -v vercel)"
  else
    echo "ERROR: Vercel CLI not found." >&2
    echo "  Looked at: ${VERCEL_BIN}" >&2
    echo "  and on PATH. Install it with: npm i -g vercel" >&2
    echo "  Or point this script at it: VERCEL_BIN=/path/to/vercel ./deploy.sh" >&2
    exit 1
  fi
fi

TARGET_ENV="production"

FORCE_ENV=0
ENV_ONLY=0
for arg in "$@"; do
  case "${arg}" in
    --force-env) FORCE_ENV=1 ;;
    --env-only)  ENV_ONLY=1 ;;
    -h|--help)   sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)
      echo "ERROR: unknown option '${arg}'. Try --help." >&2
      exit 1
      ;;
  esac
done

info()  { printf '  %s\n' "$*"; }
step()  { printf '\n== %s\n' "$*"; }
fail()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# --- Portable timeout --------------------------------------------------------
# The Vercel CLI prompts interactively when it is not logged in, which makes an
# unattended script hang forever instead of failing. Everything that could prompt is
# run under a timeout. GNU coreutils `timeout` is used when available (homebrew
# installs it as `timeout` or `gtimeout`); otherwise a background process is polled
# and killed, which is enough for the one thing we need it for.
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="$(command -v timeout)"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="$(command -v gtimeout)"
fi

# run_with_timeout <seconds> <command...>
# Exit status 124 means it timed out, matching coreutils.
run_with_timeout() {
  local seconds="$1"; shift
  if [ -n "${TIMEOUT_BIN}" ]; then
    "${TIMEOUT_BIN}" "${seconds}" "$@"
    return $?
  fi

  "$@" &
  local pid=$!
  local waited=0
  while kill -0 "${pid}" 2>/dev/null; do
    if [ "${waited}" -ge "${seconds}" ]; then
      kill -TERM "${pid}" 2>/dev/null || true
      sleep 1
      kill -KILL "${pid}" 2>/dev/null || true
      wait "${pid}" 2>/dev/null || true
      return 124
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "${pid}"
  return $?
}

# --- Preconditions -----------------------------------------------------------
step "Checking prerequisites"

[ -f "${APP_DIR}/package.json" ] || fail "package.json not found at ${APP_DIR}; this script must live inside doctor-web/."
[ -f "${LOCAL_ENV_FILE}" ]       || fail "${LOCAL_ENV_FILE} not found. It is the source of the Supabase credentials; copy .env.example and fill it in."

info "Vercel CLI: ${VERCEL_BIN} ($("${VERCEL_BIN}" --version 2>/dev/null | tail -1))"

# --- Login check -------------------------------------------------------------
# `vercel whoami` blocks on an interactive login prompt when there is no session, so
# it is the check that most needs the timeout.
step "Checking Vercel login"

WHOAMI_OUTPUT=""
set +e
WHOAMI_OUTPUT="$(run_with_timeout 20 "${VERCEL_BIN}" whoami 2>&1)"
WHOAMI_STATUS=$?
set -e

if [ "${WHOAMI_STATUS}" -eq 124 ]; then
  fail "\`vercel whoami\` timed out, which almost always means the CLI is waiting on an
  interactive login prompt. Run this first, in your own terminal:

      ${VERCEL_BIN} login

  then re-run this script."
fi

if [ "${WHOAMI_STATUS}" -ne 0 ]; then
  fail "Not logged in to Vercel (\`vercel whoami\` exited ${WHOAMI_STATUS}).
  Output: ${WHOAMI_OUTPUT}

  Run: ${VERCEL_BIN} login"
fi

VERCEL_USER="$(printf '%s' "${WHOAMI_OUTPUT}" | tail -1 | tr -d '[:space:]')"
[ -n "${VERCEL_USER}" ] || fail "Could not determine the logged-in Vercel account. Run: ${VERCEL_BIN} login"
info "Logged in as: ${VERCEL_USER}"

# --- Read values -------------------------------------------------------------
# Deliberately not `source`: these files are credential stores, not shell scripts, and
# a stray backtick or $( in a key would otherwise execute. Values are read literally.
read_env_value() {
  local file="$1" key="$2" line value
  line="$(grep -E "^[[:space:]]*${key}=" "${file}" 2>/dev/null | tail -1 || true)"
  [ -n "${line}" ] || { printf '%s' ""; return 0; }
  value="${line#*=}"
  # Strip one layer of matching surrounding quotes, if present.
  case "${value}" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "${value}"
}

step "Reading credentials"

SUPABASE_URL="$(read_env_value "${LOCAL_ENV_FILE}" NEXT_PUBLIC_SUPABASE_URL)"
SUPABASE_ANON_KEY="$(read_env_value "${LOCAL_ENV_FILE}" NEXT_PUBLIC_SUPABASE_ANON_KEY)"
SUPABASE_SERVICE_ROLE_KEY="$(read_env_value "${LOCAL_ENV_FILE}" SUPABASE_SERVICE_ROLE_KEY)"
# Observability (O1). CRON_SECRET is generated here when absent rather than being
# required, because a missing one makes the prober refuse to run -- and a deploy
# that silently ships a monitoring job that never runs is the exact failure the
# job was built to catch. The generated value is written back to .env.local so a
# re-run does not rotate it (rotating it would 401 the cron until the next deploy).
CRON_SECRET="$(read_env_value "${LOCAL_ENV_FILE}" CRON_SECRET)"
if [ -z "${CRON_SECRET}" ]; then
  CRON_SECRET="$(openssl rand -hex 32)"
  printf '\nCRON_SECRET=%s\n' "${CRON_SECRET}" >> "${LOCAL_ENV_FILE}"
  info "CRON_SECRET was missing; generated one and appended it to .env.local."
fi
# Optional. Absent means alerts are recorded but delivered nowhere -- which the
# system reports loudly rather than hiding. See .env.example.
OPS_ALERT_WEBHOOK_URL="$(read_env_value "${LOCAL_ENV_FILE}" OPS_ALERT_WEBHOOK_URL)"

# Fail before touching Vercel rather than deploying an app that throws on first use.
# Every one of these is required at runtime by `requireEnv`.
[ -n "${SUPABASE_URL}" ]              || fail "NEXT_PUBLIC_SUPABASE_URL is missing from ${LOCAL_ENV_FILE}"
[ -n "${SUPABASE_ANON_KEY}" ]         || fail "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing from ${LOCAL_ENV_FILE}"
[ -n "${SUPABASE_SERVICE_ROLE_KEY}" ] || fail "SUPABASE_SERVICE_ROLE_KEY is missing from ${LOCAL_ENV_FILE}"

# The dashboard reads the native app's live production database. Pointing it at
# anything else is not a deploy, it is a different product, so say which one out loud.
case "${SUPABASE_URL}" in
  *"${SUPABASE_PROJECT_REF}"*) : ;;
  *)
    info "WARNING: NEXT_PUBLIC_SUPABASE_URL does not name project ${SUPABASE_PROJECT_REF}."
    info "         The statistics functions (f_web_stats_*) only exist there."
    ;;
esac

info "Supabase project: ${SUPABASE_URL}"
info "Secrets loaded (values not printed)."

cd "${APP_DIR}"

# --- Link the project --------------------------------------------------------
# Without a linked project every subsequent `vercel env` call would prompt.
step "Linking the Vercel project"

if [ -f "${APP_DIR}/.vercel/project.json" ]; then
  info "Already linked (doctor-web/.vercel/project.json exists)."
else
  info "Not linked yet. Creating or attaching the project non-interactively."
  info "The Vercel project's Root Directory must be doctor-web/ (as admin-web and kiosk are)."
  set +e
  run_with_timeout 120 "${VERCEL_BIN}" link --yes
  LINK_STATUS=$?
  set -e
  if [ "${LINK_STATUS}" -eq 124 ]; then
    fail "\`vercel link\` timed out waiting on a prompt. Run \`${VERCEL_BIN} link\` once by hand, then re-run this script."
  fi
  [ "${LINK_STATUS}" -eq 0 ] || fail "\`vercel link\` failed with status ${LINK_STATUS}."
fi

# --- Environment variables ---------------------------------------------------
step "Syncing ${TARGET_ENV} environment variables"

# One `env ls` up front instead of one per variable: the CLI call is slow and the
# list does not change underneath us while we are adding to it.
set +e
ENV_LIST="$(run_with_timeout 60 "${VERCEL_BIN}" env ls "${TARGET_ENV}" 2>&1)"
ENV_LIST_STATUS=$?
set -e
if [ "${ENV_LIST_STATUS}" -ne 0 ]; then
  # A project with no variables yet can exit non-zero; treat it as empty rather than
  # aborting, because the add path below is what actually matters.
  info "Could not list existing variables (status ${ENV_LIST_STATUS}); assuming none are set."
  ENV_LIST=""
fi

env_var_exists() {
  # Match the name as a whole word so NEXT_PUBLIC_SUPABASE_URL does not match a
  # hypothetical NEXT_PUBLIC_SUPABASE_URL_OLD.
  printf '%s' "${ENV_LIST}" | grep -qE "(^|[[:space:]])$1([[:space:]]|$)"
}

# put_env <NAME> <VALUE> [optional]
# Adds the variable when absent. With --force-env, removes and re-adds it.
put_env() {
  local name="$1" value="$2" optional="${3:-}"

  if [ -z "${value}" ]; then
    if [ -n "${optional}" ]; then
      info "- ${name}: no value available, skipping (optional)"
      return 0
    fi
    fail "${name} has no value but is required."
  fi

  if env_var_exists "${name}"; then
    if [ "${FORCE_ENV}" -eq 0 ]; then
      info "= ${name}: already set, leaving it alone (use --force-env to replace)"
      return 0
    fi
    info "~ ${name}: replacing"
    set +e
    run_with_timeout 60 "${VERCEL_BIN}" env rm "${name}" "${TARGET_ENV}" --yes >/dev/null 2>&1
    set -e
  else
    info "+ ${name}: adding"
  fi

  # The value is piped on stdin so it never appears in the process list, where any
  # other user on the machine could read it with `ps`.
  set +e
  printf '%s' "${value}" | run_with_timeout 60 "${VERCEL_BIN}" env add "${name}" "${TARGET_ENV}" >/dev/null 2>&1
  local status=$?
  set -e
  [ "${status}" -eq 0 ] || fail "Failed to set ${name} (status ${status}). Try: ${VERCEL_BIN} env add ${name} ${TARGET_ENV}"
}

# The Supabase three plus the two observability variables are the complete set. Variables for intake, the LLM providers, CLOVA
# Speech, PubMed and the public-data integrations were removed along with the code
# that read them; if the Vercel project still carries them from an older deploy,
# they are dead weight and can be deleted by hand.
put_env NEXT_PUBLIC_SUPABASE_URL      "${SUPABASE_URL}"
put_env NEXT_PUBLIC_SUPABASE_ANON_KEY "${SUPABASE_ANON_KEY}"
put_env SUPABASE_SERVICE_ROLE_KEY     "${SUPABASE_SERVICE_ROLE_KEY}"
# [HARD] The name CRON_SECRET is load-bearing: Vercel Cron attaches
# `Authorization: Bearer $CRON_SECRET` only for a variable with exactly this
# name. Renaming it makes every scheduled run 401 and never succeed.
put_env CRON_SECRET                   "${CRON_SECRET}"
put_env OPS_ALERT_WEBHOOK_URL         "${OPS_ALERT_WEBHOOK_URL}" optional

if [ "${ENV_ONLY}" -eq 1 ]; then
  step "Done (--env-only): environment variables synced, nothing deployed."
  exit 0
fi

# --- Deploy ------------------------------------------------------------------
step "Deploying to production"
info "Region: icn1 (Seoul), matching the Supabase project in ap-northeast-2."
info "This takes a few minutes on a cold build."

DEPLOY_LOG="$(mktemp -t righthand-deploy)"
# Keep the build log on failure, where it is the only way to diagnose; remove it on
# success, where it is noise.
set +e
"${VERCEL_BIN}" --prod --yes --cwd "${APP_DIR}" 2>&1 | tee "${DEPLOY_LOG}"
DEPLOY_STATUS="${PIPESTATUS[0]}"
set -e

if [ "${DEPLOY_STATUS}" -ne 0 ]; then
  echo >&2
  fail "Deploy failed with status ${DEPLOY_STATUS}. Full log kept at: ${DEPLOY_LOG}"
fi

# The CLI prints several URLs (inspect, preview, production alias). Take the last
# https://...vercel.app or custom domain it emitted, which is the production one.
DEPLOY_URL="$(grep -oE 'https://[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}' "${DEPLOY_LOG}" \
  | grep -v 'vercel.com' \
  | tail -1 || true)"
rm -f "${DEPLOY_LOG}"

step "Deployed"
echo
echo "  Site: ${CANONICAL_URL}"
echo
echo "  Doctor statistics: ${CANONICAL_URL}/righthand/doctor"
echo
echo "  This deployment serves the doctor dashboard only. Patient intake lives in"
echo "  kiosk/ and is deployed separately; /righthand/patient 404s until it is."
echo
if [ -n "${DEPLOY_URL}" ]; then
  echo "  Deployment-specific URL (this build only, for debugging): ${DEPLOY_URL}"
else
  echo "  Deployment-specific URL could not be parsed from the output."
  echo "  Find it with: ${VERCEL_BIN} ls"
fi
echo
echo "  REMAINING MANUAL STEP -- Supabase Auth redirect configuration:"
echo "    https://supabase.com/dashboard/project/${SUPABASE_PROJECT_REF}/auth/url-configuration"
echo "    Set Site URL to: ${CANONICAL_URL}"
echo "    See DEPLOY.md section 3 for why, and what happens if you skip it."
echo
