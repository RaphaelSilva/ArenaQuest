# Task 08: Production Seed Guard + First-Admin Bootstrap Doc

## Metadata
- **Status:** Done — commit `012d7b7`
- **Complexity:** Medium
- **Severity closed:** S-08 (Low)
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** Task 01 (once refresh tokens are hashed, the only credential shape
  we need to guard on is the user password hash, which this task targets).

---

## Summary

Make it impossible to ship the known dev password hash to production. Provide a guarded
deploy step and a written procedure for creating the very first admin on a fresh
database.

---

## Technical Constraints

- **Deploy-time, not runtime:** the check runs as a pre-deploy hook in CI / `make
  deploy-api`. Failing a deploy is louder (and cheaper) than failing a cold start.
- **No dev-only code in prod paths:** the dev seed file moves to
  `apps/api/scripts/dev/0004_seed_dev_users.sql` to make its scope unambiguous. Update
  any Makefile / README reference.
- **Cloud-Agnostic:** the guard script shells out to `wrangler d1 execute --remote`; a
  parallel path for a non-Cloudflare D1 replacement remains possible because the script
  reads the known-bad hash from one constant.

---

## Scope

### 1. Relocate the dev seed

Move:

```
apps/api/scripts/0004_seed_dev_users.sql
→ apps/api/scripts/dev/0004_seed_dev_users.sql
```

Update any Make target / README snippet that referenced the old path.

### 2. Guard script — `apps/api/scripts/check-no-dev-seed.ts`

```ts
const DEV_PASSWORD_HASH_PREFIX =
  'pbkdf2:100000:e83835066ab015b5ed4449b68a349b38:8baf9add';

// Runs: wrangler d1 execute <db> --remote --json --command
//   "SELECT email FROM users WHERE password_hash LIKE 'pbkdf2:100000:e83835...'"
// Exits 1 if any row matches.
```

Accept `--db <name>` and `--env <prod|staging>` flags. Exit non-zero and print the
matching emails when the dev hash is found.

### 3. Wire into `make deploy-api`

```makefile
deploy-api: check-no-dev-seed
	wrangler deploy --env production

check-no-dev-seed:
	pnpm --filter api run check:no-dev-seed -- --env production
```

Add the same hook to `deploy-api-staging` (staging is not prod, but catching it early is
still cheap insurance).

### 4. First-admin bootstrap doc — `docs/product/api/bootstrap-first-admin.md`

Five-minute walk-through:

1. `cd apps/api && pnpm run gen-hash -- --password '<your-strong-password>'`
   (extend `gen-hash.ts` to read a CLI arg).
2. Copy the printed `pbkdf2:...` value.
3. Run a templated SQL (shown in the doc) via
   `wrangler d1 execute arenaquest-db --remote --command "INSERT INTO users ..."`.
4. Insert the `admin` role link into `user_roles`.
5. Log in, then **immediately** run `PATCH /admin/users/:self/roles` via the dashboard or
   `curl` to rotate the password (manual step today; superseded by the future first-login
   story).

Include a troubleshooting section ("did not use `OR IGNORE`", "forgot to link role").

---

## Acceptance Criteria

- [ ] Dev seed relocated to `apps/api/scripts/dev/`; references updated.
- [ ] `check-no-dev-seed.ts` exists and is invoked before every prod/staging deploy.
- [ ] A dry run of the deploy against a DB that contains the dev hash fails loudly; a
      clean DB passes.
- [ ] `gen-hash.ts` accepts `--password <str>` and prints only the final hash (no logs).
- [ ] `docs/product/api/bootstrap-first-admin.md` exists, is ≤ 200 lines, and a fresh
      operator can follow it in ≤ 5 min.
- [ ] `make lint` clean; existing tests pass.

---

## Verification Plan

1. Seed a local D1 with the dev SQL → run `pnpm run check:no-dev-seed -- --local` →
   exit code `1`, list of emails printed.
2. Point the check at a clean DB → exit code `0`.
3. Walk through the bootstrap doc on a throwaway D1: end state is a working admin login
   with no known hash.
