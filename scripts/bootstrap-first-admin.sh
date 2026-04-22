#!/usr/bin/env bash
# scripts/bootstrap-first-admin.sh
#
# Interactively creates the first ArenaQuest admin account.
# Supports local (make dev), staging, and production targets.
#
# Usage: bash scripts/bootstrap-first-admin.sh
#    or: make bootstrap-admin
#
# See docs/product/api/bootstrap-first-admin.md for the manual procedure.

set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { printf "${CYAN}  →  %s${RESET}\n" "$*"; }
ok()      { printf "${GREEN}  ✔  %s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}  ⚠  %s${RESET}\n" "$*"; }
die()     { printf "${RED}  ✖  %s${RESET}\n" "$*" >&2; exit 1; }
hr()      { printf "${CYAN}%s${RESET}\n" "────────────────────────────────────────────────────"; }
heading() { echo ""; printf "  ${BOLD}%s${RESET}\n" "$*"; echo ""; }

# ── constants ─────────────────────────────────────────────────────────────────
# Deterministic UUID for the 'admin' role — seeded by migration 0002_seed_roles.sql
ADMIN_ROLE_ID='bace0701-15e3-5144-97c5-47487d543032'

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
API_DIR="${REPO_ROOT}/apps/api"

# ── helpers ───────────────────────────────────────────────────────────────────

check_deps() {
  command -v node  >/dev/null 2>&1 || die "node is not installed or not in PATH"
  command -v pnpm  >/dev/null 2>&1 || die "pnpm is not installed or not in PATH"
  command -v curl  >/dev/null 2>&1 || die "curl is not installed or not in PATH"
  [[ -f "${API_DIR}/package.json" ]] || \
    die "apps/api not found — run this script from the repo root or its scripts/ directory"
}

# Escape single-quotes for SQL string literals.
sql_escape() { printf '%s' "$1" | sed "s/'/''/g"; }

# Run wrangler d1 execute from apps/api (where wrangler.jsonc lives).
# Usage: d1_exec [wrangler flags...] --command "SQL"
d1_exec() { (cd "${API_DIR}" && pnpm exec wrangler d1 execute "$@"); }

# Parse the first .id from a wrangler --json result set.
parse_id_from_json() {
  node -e "
    let d = '';
    process.stdin
      .on('data', c => d += c)
      .on('end', () => {
        try {
          const rows = JSON.parse(d).flatMap(r => r.results ?? []);
          process.stdout.write(rows[0]?.id ?? '');
        } catch { process.stdout.write(''); }
      });
  "
}

# ── main ──────────────────────────────────────────────────────────────────────

check_deps

echo ""
hr
printf "  ${BOLD}ArenaQuest — Bootstrap First Admin${RESET}\n"
hr

# ────────────────────────────────────────────────────────────────────────────
# Step 1 — Target environment
# ────────────────────────────────────────────────────────────────────────────
heading "Step 1 of 5 — Target environment"

echo "  1) local       run against the local D1 replica (make dev / wrangler dev)"
echo "  2) staging     remote arenaquest-db-staging"
echo "  3) production  remote arenaquest-db"
echo ""

while true; do
  read -rp "  Choose [1/2/3]: " ENV_CHOICE
  case "$ENV_CHOICE" in
    1)
      ENV_NAME="local"
      DB_NAME="arenaquest-db"
      D1_FLAGS="--local"
      ENV_FLAG=""
      DEFAULT_API_URL="http://localhost:8787"
      break ;;
    2)
      ENV_NAME="staging"
      DB_NAME="arenaquest-db-staging"
      D1_FLAGS="--remote --env staging"
      ENV_FLAG="--env staging"
      DEFAULT_API_URL=""
      break ;;
    3)
      ENV_NAME="production"
      DB_NAME="arenaquest-db"
      D1_FLAGS="--remote"
      ENV_FLAG=""
      DEFAULT_API_URL=""
      break ;;
    *) warn "Please enter 1, 2, or 3." ;;
  esac
done

ok "Target: ${ENV_NAME} (${DB_NAME})"

# For remote targets, ask for the Worker base URL used in the verification step.
if [[ -z "$DEFAULT_API_URL" ]]; then
  echo ""
  read -rp "  Worker URL for login verification (e.g. https://api.xxx.workers.dev): " API_URL
  API_URL="${API_URL%/}"
else
  API_URL="$DEFAULT_API_URL"
fi

# Local-only preflight: warn if migrations haven't been applied yet.
if [[ "$ENV_NAME" == "local" ]]; then
  LOCAL_DB_DIR="${API_DIR}/.wrangler/state/v3/d1"
  if [[ ! -d "$LOCAL_DB_DIR" ]]; then
    echo ""
    warn "Local D1 state not found (${LOCAL_DB_DIR})."
    warn "Apply migrations first:  make db-migrate-local"
    echo ""
    read -rp "  Continue anyway? [y/N]: " CONTINUE_ANYWAY
    [[ "${CONTINUE_ANYWAY,,}" == "y" ]] || die "Aborted."
  fi
fi

# ────────────────────────────────────────────────────────────────────────────
# Step 2 — Account details
# ────────────────────────────────────────────────────────────────────────────
heading "Step 2 of 5 — Account details"

read -rp "  Full name : " ADMIN_NAME
[[ -n "$ADMIN_NAME" ]] || die "Name cannot be empty."

read -rp "  Email     : " ADMIN_EMAIL
[[ "$ADMIN_EMAIL" == *@*.* ]] || die "Email does not look valid."

# ────────────────────────────────────────────────────────────────────────────
# Step 3 — Password
# ────────────────────────────────────────────────────────────────────────────
heading "Step 3 of 5 — Password"

echo "  Use a password manager to generate a random passphrase."
echo "  Requirements: ≥ 20 characters · mixed case · digits · symbols"
echo ""

while true; do
  read -rsp "  Password         : " ADMIN_PASSWORD
  echo ""
  if [[ ${#ADMIN_PASSWORD} -lt 20 ]]; then
    warn "Too short (${#ADMIN_PASSWORD} chars — need ≥ 20). Try again."
    continue
  fi
  read -rsp "  Confirm password : " ADMIN_PASSWORD2
  echo ""
  if [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD2" ]]; then
    warn "Passwords do not match. Try again."
    continue
  fi
  break
done
ok "Password accepted (${#ADMIN_PASSWORD} chars)."

# ────────────────────────────────────────────────────────────────────────────
# Step 4 — Generate UUID + PBKDF2 hash
# ────────────────────────────────────────────────────────────────────────────
heading "Step 4 of 5 — Generating credentials"

USER_ID="$(node -e "console.log(crypto.randomUUID())")"
info "User ID  : ${USER_ID}"

info "Hashing password (PBKDF2 × 210 000 — takes a few seconds) ..."
HASH="$(cd "${API_DIR}" && pnpm run --silent gen-hash -- --password "${ADMIN_PASSWORD}" 2>/dev/null)"
[[ -n "$HASH" ]] || die "gen-hash returned empty output — check apps/api/scripts/gen-hash.ts"
ok "Password hash generated."

# ────────────────────────────────────────────────────────────────────────────
# Step 5 — Write to database
# ────────────────────────────────────────────────────────────────────────────
heading "Step 5 of 5 — Writing to ${ENV_NAME} database"

SAFE_NAME="$(sql_escape "${ADMIN_NAME}")"
SAFE_EMAIL="$(sql_escape "${ADMIN_EMAIL}")"

# Insert user (idempotent — OR IGNORE skips if email already exists).
info "Inserting user row ..."
d1_exec "${DB_NAME}" ${D1_FLAGS} --command \
  "INSERT OR IGNORE INTO users (id, name, email, password_hash, status)
   VALUES ('${USER_ID}', '${SAFE_NAME}', '${SAFE_EMAIL}', '${HASH}', 'active');" \
  >/dev/null 2>&1 || die "wrangler d1 execute failed — check DB name and migrations."

# Confirm the row exists and capture the actual ID (handles pre-existing email).
ACTUAL_ID="$(d1_exec "${DB_NAME}" ${D1_FLAGS} --json \
  --command "SELECT id FROM users WHERE email = '${SAFE_EMAIL}';" \
  2>/dev/null | parse_id_from_json)"

if [[ -z "$ACTUAL_ID" ]]; then
  die "User row not found after INSERT.
  If targeting local, apply migrations first: make db-migrate-local
  If targeting remote, verify the DB name and wrangler authentication."
fi

if [[ "$ACTUAL_ID" != "$USER_ID" ]]; then
  warn "Email '${ADMIN_EMAIL}' already existed in the DB (id=${ACTUAL_ID})."
  warn "Will assign the admin role to the existing account instead."
  USER_ID="$ACTUAL_ID"
else
  ok "User row created."
fi

# Assign admin role (idempotent).
info "Assigning admin role ..."
d1_exec "${DB_NAME}" ${D1_FLAGS} --command \
  "INSERT OR IGNORE INTO user_roles (user_id, role_id)
   VALUES ('${USER_ID}', '${ADMIN_ROLE_ID}');" \
  >/dev/null 2>&1 || die "Failed to assign admin role."
ok "Admin role assigned."

# ────────────────────────────────────────────────────────────────────────────
# Verification — test the login endpoint
# ────────────────────────────────────────────────────────────────────────────
echo ""
hr
info "Verifying login at ${API_URL}/auth/login ..."

# For local mode, check the dev server is actually up before curling.
if [[ "$ENV_NAME" == "local" ]]; then
  if ! curl -sf --max-time 3 "${API_URL}/health" >/dev/null 2>&1; then
    echo ""
    warn "Dev server is not running at ${API_URL}."
    warn "Start it with 'make dev-api' in another terminal and verify manually:"
    echo ""
    printf "  curl -s -X POST %s/auth/login \\\\\n" "${API_URL}"
    printf "    -H 'Content-Type: application/json' \\\\\n"
    printf "    -d '{\"email\":\"%s\",\"password\":\"<password>\"}' | jq .user\n" "${ADMIN_EMAIL}"
    echo ""
    SKIP_VERIFY=true
  fi
fi

if [[ "${SKIP_VERIFY:-false}" != "true" ]]; then
  LOGIN_RESP="$(curl -sf --max-time 10 -X POST "${API_URL}/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    2>/dev/null || true)"

  if echo "${LOGIN_RESP}" | grep -q '"admin"'; then
    ok "Login verified — account has the 'admin' role."
  elif [[ -z "$LOGIN_RESP" ]]; then
    warn "No response from ${API_URL} — skipping login check."
    warn "Verify manually once the Worker is deployed."
  else
    warn "Unexpected response (expected JSON with roles containing 'admin'):"
    echo "${LOGIN_RESP}" | node -e "
      let d='';
      process.stdin.on('data',c=>d+=c).on('end',()=>{
        try  { process.stdout.write(JSON.stringify(JSON.parse(d),null,2)+'\n'); }
        catch { process.stdout.write(d+'\n'); }
      });" 2>/dev/null || printf '%s\n' "${LOGIN_RESP}"
    echo ""
    warn "If the Worker is freshly deployed the response may be correct — check manually."
  fi
fi

# ────────────────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────────────────
echo ""
hr
printf "  ${GREEN}${BOLD}Bootstrap complete!${RESET}\n"
hr
echo ""
printf "  %-14s %s\n" "Environment :"  "${ENV_NAME}"
printf "  %-14s %s\n" "User ID     :"  "${USER_ID}"
printf "  %-14s %s\n" "Name        :"  "${ADMIN_NAME}"
printf "  %-14s %s\n" "Email       :"  "${ADMIN_EMAIL}"
echo ""
warn "Store the password in your password manager — it cannot be recovered from the DB."
echo ""
