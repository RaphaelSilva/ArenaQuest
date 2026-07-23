#!/usr/bin/env bash
# scripts/doctor.sh
#
# Read-only diagnosis of a local ArenaQuest development environment.
# Mutates NOTHING — no installs, no migrations, no file writes.
#
# Usage: make doctor
#    or: bash scripts/doctor.sh
#
# Exit codes (same contract as `make label-check` / scripts/label.mjs):
#   0  everything present and healthy
#   1  at least one hard gap — the stack will not run correctly
#   2  only soft gaps (optional/skipped checks) outstanding

set -uo pipefail   # NOT -e: a failing probe is a finding, not a crash.

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
API_DIR="${REPO_ROOT}/apps/api"
WEB_DIR="${REPO_ROOT}/apps/web"
D1_STATE_DIR="${API_DIR}/.wrangler/state/v3/d1"

# shellcheck source=scripts/lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

cd "${REPO_ROOT}"

# ── result accumulation ───────────────────────────────────────────────────────
FAILS=0
SOFT=0

# pass <key> <detail>
pass() { printf "    ${GREEN}✅${RESET} %-24s %s\n" "$1" "${2:-}"; }

# gap <key> <detail> <fix>   — hard gap, drives exit 1
gap() {
  printf "    ${RED}❌${RESET} %-24s %s\n" "$1" "${2:-}"
  [[ -n "${3:-}" ]] && printf "        ${DIM}→ %s${RESET}\n" "$3"
  FAILS=$((FAILS + 1))
}

# soft <key> <detail> <fix>  — optional/skipped, drives exit 2
soft() {
  printf "    ${YELLOW}⚠️${RESET}  %-24s %s\n" "$1" "${2:-}"
  [[ -n "${3:-}" ]] && printf "        ${DIM}→ %s${RESET}\n" "$3"
  SOFT=$((SOFT + 1))
}

group() { printf "  ${BOLD}%s${RESET}\n" "$1"; }

version_gte() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

# Is a TCP port on localhost accepting connections?
port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

# Read a KEY=value from a dotenv-style file (last occurrence wins).
env_value() {
  [[ -f "$1" ]] || return 1
  sed -n "s/^$2=//p" "$1" | tail -n1
}

# Run a read-only SELECT against the local D1 replica.
d1_query() {
  (cd "${API_DIR}" && pnpm exec wrangler d1 execute arenaquest-db --local \
    --json --command "$1" 2>/dev/null)
}

echo ""
hr
printf "  ${BOLD}ArenaQuest — Environment Doctor${RESET}\n"
hr
echo ""

# ────────────────────────────────────────────────────────────────────────────
group "toolchain"
# ────────────────────────────────────────────────────────────────────────────
if command -v node >/dev/null 2>&1; then
  NODE_VERSION="$(node -v | sed 's/^v//')"
  if version_gte "${NODE_VERSION}" "20.0.0"; then
    pass "node" "v${NODE_VERSION}"
  else
    gap "node" "v${NODE_VERSION} (need >= 20)" "install Node 20+ — see package.json engines"
  fi
else
  gap "node" "not found" "install Node 20+"
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_VERSION="$(pnpm -v)"
  if version_gte "${PNPM_VERSION}" "9.0.0"; then
    pass "pnpm" "v${PNPM_VERSION}"
  else
    gap "pnpm" "v${PNPM_VERSION} (need >= 9)" "corepack enable && corepack prepare pnpm@9 --activate"
  fi
else
  gap "pnpm" "not found" "corepack enable"
fi

if [[ -d "${REPO_ROOT}/node_modules" ]]; then
  pass "dependencies" "node_modules present"
else
  gap "dependencies" "node_modules missing" "make install"
fi

# ────────────────────────────────────────────────────────────────────────────
echo ""
group "local-env"
# ────────────────────────────────────────────────────────────────────────────
if [[ -f "${API_DIR}/.dev.vars" ]]; then
  pass "apps/api/.dev.vars" "present"

  JWT="$(env_value "${API_DIR}/.dev.vars" "JWT_SECRET")"
  if [[ -z "${JWT}" ]]; then
    gap "JWT_SECRET" "empty" "make setup, or set it by hand in apps/api/.dev.vars"
  elif [[ "${JWT}" == "local-dev-only-secret-replace-in-staging-and-prod" ]]; then
    soft "JWT_SECRET" "still the template placeholder" \
      "fine for local dev; replace before sharing this machine"
  else
    pass "JWT_SECRET" "set"
  fi

  SAMESITE="$(env_value "${API_DIR}/.dev.vars" "COOKIE_SAMESITE")"
  if [[ "${SAMESITE}" == "Lax" ]]; then
    pass "COOKIE_SAMESITE" "Lax"
  else
    soft "COOKIE_SAMESITE" "${SAMESITE:-unset} (expected Lax locally)" \
      "over http://localhost, SameSite=None is dropped — causes sticky 401s after 15 min"
  fi
else
  gap "apps/api/.dev.vars" "missing" "make setup"
fi

if [[ -f "${WEB_DIR}/.env.local" ]]; then
  API_URL="$(env_value "${WEB_DIR}/.env.local" "NEXT_PUBLIC_API_URL")"
  if [[ -z "${API_URL}" ]]; then
    gap "NEXT_PUBLIC_API_URL" "empty in apps/web/.env.local" "set it to http://localhost:8787"
  elif [[ "${API_URL}" == */v1* ]]; then
    gap "NEXT_PUBLIC_API_URL" "${API_URL} contains /v1" \
      "api-client.ts adds the /v1 prefix — requests would double-prefix"
  else
    pass "apps/web/.env.local" "${API_URL}"
  fi
else
  gap "apps/web/.env.local" "missing" "make setup"
fi

if [[ -f "${REPO_ROOT}/.envs.test" ]]; then
  pass ".envs.test" "present"
else
  soft ".envs.test" "missing" "only needed by the qa-tester skill — make setup creates it"
fi

# ────────────────────────────────────────────────────────────────────────────
echo ""
group "local-db"
# ────────────────────────────────────────────────────────────────────────────
if [[ -d "${D1_STATE_DIR}" ]]; then
  pass "local D1 state" ".wrangler/state/v3/d1"

  USERS_JSON="$(d1_query "SELECT COUNT(*) AS n FROM users;")"
  if [[ -z "${USERS_JSON}" ]]; then
    gap "schema" "could not query the users table" "make db-migrate-local"
  else
    pass "schema" "migrations applied"

    SEED_JSON="$(d1_query "SELECT COUNT(*) AS n FROM users WHERE email LIKE '%@arenaquest.dev';")"
    SEED_COUNT="$(printf '%s' "${SEED_JSON}" | node -e "
      let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
        try { const r=JSON.parse(d).flatMap(x=>x.results??[]); process.stdout.write(String(r[0]?.n ?? 0)); }
        catch { process.stdout.write('0'); }
      });" 2>/dev/null)"
    if [[ "${SEED_COUNT:-0}" -ge 3 ]]; then
      pass "seed accounts" "${SEED_COUNT} present"
    else
      soft "seed accounts" "${SEED_COUNT:-0} of 3 present" "make db-seed-local"
    fi
  fi
else
  gap "local D1 state" "not created yet" "make setup (or: make db-migrate-local)"
fi

# ────────────────────────────────────────────────────────────────────────────
echo ""
group "ports"
# ────────────────────────────────────────────────────────────────────────────
for PORT_SPEC in "3000:web (next dev)" "8787:api (wrangler dev)"; do
  PORT="${PORT_SPEC%%:*}"
  WHAT="${PORT_SPEC#*:}"
  if port_in_use "${PORT}"; then
    soft "port ${PORT}" "in use — expected if ${WHAT} is already running" \
      "if it is not ours: lsof -i :${PORT}"
  else
    pass "port ${PORT}" "free (${WHAT})"
  fi
done

# ────────────────────────────────────────────────────────────────────────────
echo ""
group "cloudflare"
# ────────────────────────────────────────────────────────────────────────────
# Never a hard gap: local development is fully offline. This only gates the
# staging/production targets.
WHOAMI="$( (cd "${API_DIR}" && pnpm exec wrangler whoami 2>/dev/null) )"
if printf '%s' "${WHOAMI}" | grep -qi "You are logged in"; then
  ACCOUNT="$(printf '%s' "${WHOAMI}" | grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+' | head -n1)"
  pass "wrangler auth" "${ACCOUNT:-logged in}"
else
  soft "wrangler auth" "not logged in" \
    "only needed for staging/production: pnpm --filter api exec wrangler login"
fi

# ────────────────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────────────────
if   [[ "${FAILS}" -gt 0 ]]; then EXIT_CODE=1
elif [[ "${SOFT}"  -gt 0 ]]; then EXIT_CODE=2
else                              EXIT_CODE=0
fi

echo ""
hr
printf "  Summary: ${BOLD}%d${RESET} hard gap(s), ${BOLD}%d${RESET} soft item(s).  Exit %d.\n" \
  "${FAILS}" "${SOFT}" "${EXIT_CODE}"
if [[ "${FAILS}" -gt 0 ]]; then
  printf "  ${YELLOW}Run 'make setup' to resolve the gaps above.${RESET}\n"
fi
hr
echo ""

exit "${EXIT_CODE}"
