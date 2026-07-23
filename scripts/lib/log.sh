# scripts/lib/log.sh
#
# Shared colour constants and logging helpers for the ArenaQuest shell scripts.
# Source it — never execute it:
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "${SCRIPT_DIR}/lib/log.sh"
#
# The icon vocabulary matches `scripts/label.mjs` so `make doctor` and
# `make label-check` read alike: ✔ pass · ✖ hard gap · ⚠ soft gap / skipped.

# ── colours ───────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

# ── log helpers ───────────────────────────────────────────────────────────────
info()    { printf "${CYAN}  →  %s${RESET}\n" "$*"; }
ok()      { printf "${GREEN}  ✔  %s${RESET}\n" "$*"; }
warn()    { printf "${YELLOW}  ⚠  %s${RESET}\n" "$*"; }
fail()    { printf "${RED}  ✖  %s${RESET}\n" "$*"; }
die()     { printf "${RED}  ✖  %s${RESET}\n" "$*" >&2; exit 1; }
hint()    { printf "${DIM}      → %s${RESET}\n" "$*"; }
hr()      { printf "${CYAN}%s${RESET}\n" "────────────────────────────────────────────────────"; }
heading() { echo ""; printf "  ${BOLD}%s${RESET}\n" "$*"; echo ""; }
