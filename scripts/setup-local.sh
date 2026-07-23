#!/usr/bin/env bash
# scripts/setup-local.sh
#
# One-shot, idempotent bring-up of a local ArenaQuest development environment.
# Safe to re-run: every step reports whether it acted or skipped, and no
# existing file is ever overwritten.
#
# Usage: make setup
#    or: bash scripts/setup-local.sh
#
# Local development needs NO Cloudflare account. Only media upload (R2) and
# Google sign-in require real credentials — see docs/onboarding.md.

set -euo pipefail

# ── paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
API_DIR="${REPO_ROOT}/apps/api"
WEB_DIR="${REPO_ROOT}/apps/web"

# shellcheck source=scripts/lib/log.sh
source "${SCRIPT_DIR}/lib/log.sh"

cd "${REPO_ROOT}"

# ── helpers ───────────────────────────────────────────────────────────────────

# Compare two dotted versions: returns 0 when $1 >= $2.
version_gte() {
  [[ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

# Copy <example> to <target> unless <target> already exists.
# Sets COPIED=true when it actually created the file.
copy_template() {
  local example="$1" target="$2" label="$3"
  COPIED=false
  if [[ -f "${target}" ]]; then
    ok "${label} — kept (already exists)"
    return 0
  fi
  [[ -f "${example}" ]] || die "template not found: ${example#${REPO_ROOT}/}"
  cp "${example}" "${target}"
  COPIED=true
  ok "${label} — created from $(basename "${example}")"
}

echo ""
hr
printf "  ${BOLD}ArenaQuest — Local Setup${RESET}\n"
hr

# ────────────────────────────────────────────────────────────────────────────
# Step 1 — Toolchain preflight
# ────────────────────────────────────────────────────────────────────────────
heading "Step 1 of 6 — Toolchain"

command -v node >/dev/null 2>&1 || die "node is not installed or not in PATH (need >= 20)"
command -v pnpm >/dev/null 2>&1 || die "pnpm is not installed or not in PATH (need >= 9) — try: corepack enable"
command -v curl >/dev/null 2>&1 || die "curl is not installed or not in PATH"

NODE_VERSION="$(node -v | sed 's/^v//')"
PNPM_VERSION="$(pnpm -v)"

version_gte "${NODE_VERSION}" "20.0.0" \
  || die "node ${NODE_VERSION} is too old — package.json requires >= 20"
version_gte "${PNPM_VERSION}" "9.0.0" \
  || die "pnpm ${PNPM_VERSION} is too old — package.json requires >= 9"

ok "node ${NODE_VERSION}"
ok "pnpm ${PNPM_VERSION}"

# ────────────────────────────────────────────────────────────────────────────
# Step 2 — Dependencies
# ────────────────────────────────────────────────────────────────────────────
heading "Step 2 of 6 — Dependencies"

# pnpm install is itself idempotent and fast on a warm store, but skipping the
# spawn entirely keeps a re-run of `make setup` near-instant.
if [[ -f "${REPO_ROOT}/node_modules/.modules.yaml" ]] \
   && [[ "${REPO_ROOT}/node_modules/.modules.yaml" -nt "${REPO_ROOT}/pnpm-lock.yaml" ]]; then
  ok "workspace dependencies — up to date"
else
  info "Running pnpm install (frozen lockfile) ..."
  pnpm install --frozen-lockfile
  ok "workspace dependencies installed"
fi

# ────────────────────────────────────────────────────────────────────────────
# Step 3 — Local environment files
# ────────────────────────────────────────────────────────────────────────────
heading "Step 3 of 6 — Environment files"

copy_template "${API_DIR}/.dev.vars.example" "${API_DIR}/.dev.vars" "apps/api/.dev.vars"
DEV_VARS_CREATED="${COPIED}"

copy_template "${WEB_DIR}/.env.example" "${WEB_DIR}/.env.local" "apps/web/.env.local"

copy_template "${REPO_ROOT}/.envs.test.example" "${REPO_ROOT}/.envs.test" ".envs.test"

# ────────────────────────────────────────────────────────────────────────────
# Step 4 — Generate a real JWT_SECRET
# ────────────────────────────────────────────────────────────────────────────
heading "Step 4 of 6 — JWT secret"

# Only touch a .dev.vars this script just created — never rewrite a developer's
# own secret on a re-run.
if [[ "${DEV_VARS_CREATED}" == "true" ]]; then
  JWT_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  # The template ships a placeholder line; replace it in place.
  TMP_VARS="$(mktemp)"
  JWT_SECRET="${JWT_SECRET}" node -e "
    const fs = require('node:fs');
    const src = fs.readFileSync(process.argv[1], 'utf8');
    const next = src.replace(/^JWT_SECRET=.*$/m, 'JWT_SECRET=' + process.env.JWT_SECRET);
    fs.writeFileSync(process.argv[2], next);
  " "${API_DIR}/.dev.vars" "${TMP_VARS}"
  mv "${TMP_VARS}" "${API_DIR}/.dev.vars"
  ok "JWT_SECRET — generated (32 random bytes)"
else
  ok "JWT_SECRET — kept (existing .dev.vars left untouched)"
fi

# ────────────────────────────────────────────────────────────────────────────
# Step 5 — Local D1 schema
# ────────────────────────────────────────────────────────────────────────────
heading "Step 5 of 6 — Local database"

info "Applying migrations to the local D1 replica ..."
make -C "${REPO_ROOT}" --no-print-directory db-migrate-local
ok "migrations applied"

# ────────────────────────────────────────────────────────────────────────────
# Step 6 — Seed accounts
# ────────────────────────────────────────────────────────────────────────────
heading "Step 6 of 6 — Seed accounts"

info "Seeding local development accounts ..."
make -C "${REPO_ROOT}" --no-print-directory db-seed-local
ok "seed applied (idempotent — no duplicates on re-run)"

# ────────────────────────────────────────────────────────────────────────────
# Summary
# ────────────────────────────────────────────────────────────────────────────
echo ""
hr
printf "  ${GREEN}${BOLD}Setup complete!${RESET}\n"
hr
echo ""
printf "  ${BOLD}Start the stack${RESET}\n\n"
printf "    make dev            # both apps in parallel\n"
printf "    make doctor         # re-check this environment at any time\n"
echo ""
printf "  ${BOLD}URLs${RESET}\n\n"
printf "    Web   http://localhost:3000\n"
printf "    API   http://localhost:8787\n"
echo ""
printf "  ${BOLD}Seed accounts${RESET} ${DIM}(local only — never seeded remotely)${RESET}\n\n"
printf "    %-28s %s\n" "admin@arenaquest.dev"     "Admin1234!"
printf "    %-28s %s\n" "student@arenaquest.dev"   "Student1234!"
printf "    %-28s %s\n" "professor@arenaquest.dev" "Professor1234!"
echo ""
warn "Optional, and NOT configured by this script:"
hint "media upload needs real R2 credentials in apps/api/.dev.vars"
hint "Google sign-in needs GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET"
hint "remote (staging/production) commands need: pnpm --filter api exec wrangler login"
echo ""
printf "  See ${BOLD}docs/onboarding.md${RESET} for the full runbook.\n"
echo ""
