# Task: Pre-Deploy Seed Guard — Detection Drifted Away From the Actual Seed

## Metadata
- **Status:** ✅ Done
- **Complexity:** Small
- **Priority:** Medium
- **Category:** Security / Deployment
- **Dependencies:** None
- **Origin:** Milestone 19, [Task 02 — Billing schema, D1 repository and local seed](../../milestones/19-student-billing-and-receivables/02-billing-schema-d1-repository-and-local-seed.task.md) (acceptance criterion marked `[~]`)

---

## Summary

`apps/api/scripts/check-no-dev-seed.ts` is the pre-deploy guard that refuses to
release over a database still holding the local development accounts. It matches
on a single hard-coded password-hash prefix that **corresponds to none of the
accounts in `apps/api/migrations/seed/`**. The guard therefore reports
`OK — no dev-seed hashes found` against a database that is fully seeded, and
every deploy path that relies on it is unprotected.

This is a **pre-existing defect**, not a regression introduced by Milestone 19.
M19 only made it visible: Task 02 added a fourth seed account and could not
satisfy the "the guard still refuses the seed on a deployed target" criterion.

---

## Problem Statement

**The constant and the seed disagree.**

`check-no-dev-seed.ts` matches two ways, both derived from one salt:

```ts
const DEV_PASSWORD_HASH_PREFIX =
  'pbkdf2:100000:e83835066ab015b5ed4449b68a349b38:8baf9add';
const DEV_HASH_LIKE_PATTERN = 'pbkdf2:100000:e83835066ab015b5%';
```

The salts actually present in `apps/api/migrations/seed/`:

| Account | File | Salt |
|---|---|---|
| `admin@arenaquest.dev` | `0001_test_users.sql` | `14987ad9c165000b3c1deb276aceb877` |
| `student@arenaquest.dev` | `0001_test_users.sql` | `fd6f1ec294b6ab4140128e8e417da852` |
| `professor@arenaquest.dev` | `0001_test_users.sql` | `eafc23fd552a682ad8f800dd8df7a027` |
| `student2@arenaquest.dev` | `0002_billing_local.sql` | `fd6f1ec294b6ab4140128e8e417da852` |

`e83835066ab015b5…` matches none of them. The SQL `LIKE` returns zero rows, the
JavaScript `startsWith()` filter has nothing to filter, and the script exits `0`.

**Impact.** Every caller believes it is protected when it is not:

- `Makefile:361` `guard-no-dev-seed-staging` and `Makefile:366` `guard-no-dev-seed-prod`
- `scripts/cloudflare/deploy.mjs:101` — the preflight inside the label-aware deploy CLI,
  which is the single release code path for every label and both environments, in CI included

**Severity is moderate, not critical**, because nothing in the repository ever
applies the seed remotely: `make db-seed-local` (`Makefile:182`) runs `wrangler
d1 execute … --local` for both seed files, and there is no target that points
them at a remote database. The guard is defence in depth against a hand-run
`wrangler d1 execute --remote`, a restored local dump, or an admin bootstrapped
with a dev password. That defence is currently inert.

**Documentation asserts the protection as a fact.** These statements are false
while the drift stands, and must be corrected together with the fix:

- `docs/onboarding.md:81-83` — "The deploy targets run `check-no-dev-seed.ts` … and abort if the dev-seed password hash is found there."
- `docs/product/milestones/19-student-billing-and-receivables/milestone.md:115` — "local seed extension … (guarded off the deployed path by `check-no-dev-seed.ts`)"
- `docs/product/RFCs/0013-student-billing-contracts-and-receivables-accounting.md:694` — same claim
- `docs/product/milestones/19-student-billing-and-receivables/02-…task.md:61-62` — same claim in the task's own guardrails

---

## Root Cause

The guard's matcher is a **manual copy** of a value that lives somewhere else.
`apps/api/scripts/generate-seed-hashes.ts` regenerates the seed hashes with a
fresh random salt on every run, and its header instructs the developer to paste
the output into `migrations/seed/0001_test_users.sql` — with no step that
updates the guard. Any regeneration silently disarms the guard.

Two secondary symptoms of the same cause:

1. `apps/api/test/core/check-no-dev-seed.spec.ts` covers only
   `isFreshDatabaseError`. The matching logic — the reason the script exists —
   has no test, so the drift could not fail a build.
2. `generate-seed-hashes.ts` still lists three accounts and names
   `0001_test_users.sql` as the only destination; it does not know about
   `0002_billing_local.sql` or `student2@arenaquest.dev`, whose hash was
   copied verbatim from `student@arenaquest.dev` rather than generated.

---

## Architectural Context

- The script is invoked through `pnpm --filter api exec tsx`, runs in Node (not
  in a Worker), and shells out to `wrangler d1 execute --json`. It has no
  application imports and must keep having none.
- It is explicitly listed as **reused unchanged** by the Milestone 17 and 18
  scope guardrails. Changing it is in scope *here*, in its own task — that is
  precisely why those milestones deferred it.
- The short `LIKE` pattern is deliberate: local D1 (miniflare/workerd SQLite)
  raises `LIKE or GLOB pattern too complex` on long patterns, which is why the
  SQL filter is coarse and the exact match happens in JavaScript. Any fix must
  preserve that two-stage shape.

---

## Scope

### 1. Derive the matchers from the seed files instead of hard-coding them

Replace `DEV_PASSWORD_HASH_PREFIX` / `DEV_HASH_LIKE_PATTERN` with values read at
run time from `apps/api/migrations/seed/*.sql`:

- Parse every `pbkdf2:…` literal out of the seed SQL and build one exact-prefix
  list (salt + a short slice of the derived key) for the JavaScript filter.
- Build the SQL filter from the iteration count plus a **short** salt prefix per
  distinct salt, kept under the pattern-complexity limit — one `LIKE` per salt
  OR-ed together, or a single `IN` over the extracted `id` values, whichever
  stays within the limit.
- Also extract the seeded primary keys (every `id` beginning with `seed-`) and
  match on those as a second, hash-independent signal. The ids are hard-coded in
  the seed and therefore stable; they survive a hash regeneration.

The guard then cannot drift: regenerating hashes or adding a fifth seed account
updates the matcher automatically.

### 2. Cover the matching logic with tests

Extend `apps/api/test/core/check-no-dev-seed.spec.ts`:

- Export the extraction and the row filter as pure functions and assert that the
  matchers built from the real `migrations/seed/*.sql` files match **all four**
  seeded accounts, `student2@arenaquest.dev` included.
- Assert a non-seed user (a real PBKDF2 hash with an unrelated salt, an id that
  is not `seed-`-prefixed) is **not** matched — the regression that would turn
  the guard into a deploy blocker for legitimate databases.
- Assert the generated SQL `LIKE` pattern stays under the length that trips
  `LIKE or GLOB pattern too complex` on the local replica.

### 3. Realign `generate-seed-hashes.ts`

Add `student2@arenaquest.dev` to its `ACCOUNTS` list and update the header so it
names both seed files as destinations. With scope 1 in place, regenerating
hashes no longer requires touching the guard — state that in the header.

### 4. Correct the documentation that asserts the protection

Update the four locations listed under *Problem Statement* only after the guard
actually works. No wording change is a substitute for the fix.

### Out of scope

- Changing the seed accounts, their passwords, ids or hashes.
- Adding the fourth account to the onboarding/CONTRIBUTING tables, `setup-local.sh`
  or `doctor.sh` — that is documentation upkeep, tracked separately.
- Any change to `scripts/cloudflare/deploy.mjs` or the Makefile targets: the
  call sites are correct, only the detection is broken.
- Reworking how the seed is applied, or adding a remote seed path.

---

## Technical Constraints

- **No new dependencies.** Node built-ins only (`node:fs`, `node:path`,
  `node:child_process`), matching the script's current style.
- **The script must stay runnable standalone** via `tsx scripts/check-no-dev-seed.ts`
  with no build step, and keep its `import.meta.url` main-guard so it remains importable
  from a spec.
- **Exit codes are a contract** — `0` clean, `1` seed found, `2` usage or
  wrangler failure — and `isFreshDatabaseError` must keep turning
  `no such table: users` into exit `0` for a freshly provisioned database
  (relied upon by Milestone 18, `04-ensure-worker-via-deploy-cli.task.md:43`).
- **Fail closed.** If the seed files cannot be read or no matcher can be built,
  exit `2` with a clear message — never exit `0` on an empty matcher set, which
  is the exact failure shape being fixed.
- **Never print a password hash** to stdout or stderr; report the offending
  emails only, as the script does today.

---

## Acceptance Criteria

- [x] Against a freshly seeded local replica (`make db-reset-local`), running the
      guard with `--local` exits `1` and lists all four `@arenaquest.dev`
      accounts, `student2@arenaquest.dev` included.
- [x] Against a database with no seed rows, the guard exits `0` and prints
      `OK — no dev-seed hashes found`.
- [x] Regenerating the hashes with `generate-seed-hashes.ts` and pasting them
      into the seed files leaves the guard working with **no edit to the guard**.
- [x] A fresh database without a `users` table still exits `0` via
      `isFreshDatabaseError`.
- [x] A wrangler auth/network failure still exits `2` and surfaces wrangler's own
      error before the script's hint block.
- [x] Unreadable or empty seed files exit `2`, never `0`.
- [x] `apps/api/test/core/check-no-dev-seed.spec.ts` covers the matcher against
      the real seed files and against a non-seed user; `make test-api` is green.
- [x] The four documentation claims listed in *Problem Statement* are true again.
- [x] `make lint` clean. No diff in `scripts/cloudflare/deploy.mjs`, in the
      `guard-no-dev-seed-*` Makefile targets, or in `migrations/seed/**`.

---

## Verification Plan

1. `make db-reset-local`, then
   `pnpm --filter api exec tsx scripts/check-no-dev-seed.ts --db arenaquest-db --local`
   — expect exit `1` and the four emails. Confirm with `echo $?`.
2. Delete the seeded rows from the local replica (or re-migrate without seeding)
   and re-run — expect exit `0`.
3. Confirm no `LIKE or GLOB pattern too complex` error appears against the local
   replica, which is where that limit actually bites.
4. `make test-api` for the guard spec.
5. Dry-run the deploy preflight against staging
   (`node scripts/cloudflare/deploy.mjs --label arenaquest -e staging --dry-run`)
   and confirm the guard step still runs and still passes on a clean staging
   database — the fix must not block a legitimate deploy.
