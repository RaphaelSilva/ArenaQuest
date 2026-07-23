# Onboarding — Running ArenaQuest on a New Machine

Everything you need to go from a fresh clone to a working local stack.

**Local development needs no Cloudflare account.** The API runs against a local
D1 replica (SQLite on disk) and a local KV simulation, both provided by
`wrangler dev`. You only need Cloudflare credentials for media upload (R2),
Google sign-in, and anything targeting staging or production.

---

## 1. The 10-minute path

**Prerequisites:** Node ≥ 20 and pnpm ≥ 9 (`corepack enable` gives you pnpm).

```bash
git clone <repo-url> ArenaQuest
cd ArenaQuest

make setup      # installs deps, creates env files, migrates + seeds local D1
make dev        # web on :3000, API on :8787
```

Log in at <http://localhost:3000> with `admin@arenaquest.dev` / `Admin1234!`.

That is the whole happy path. If anything looks wrong at any point:

```bash
make doctor     # read-only diagnosis; tells you exactly which target to run
```

`make setup` is idempotent — re-run it whenever you are unsure. It never
overwrites a file you already have, and reports `kept` for each one it skips.

---

## 2. What `make setup` creates

None of these are committed; all are gitignored. This is why a fresh clone
cannot run until you create them.

| File | Created from | What it is |
|---|---|---|
| `apps/api/.dev.vars` | `.dev.vars.example` | Worker secrets and vars for `wrangler dev` |
| `apps/web/.env.local` | `.env.example` | `NEXT_PUBLIC_API_URL` and white-label build vars |
| `.envs.test` | `.envs.test.example` | Test accounts used by the `qa-tester` skill |
| `apps/api/.wrangler/state/v3/d1` | migrations | The local D1 (SQLite) replica |

On first creation only, `setup` replaces the template's placeholder
`JWT_SECRET` with 32 random bytes. On a re-run it leaves your `.dev.vars`
completely untouched.

### Optional credentials — not configured by setup

The stack runs without all of these. Fill them in `apps/api/.dev.vars` only
when you need the corresponding feature:

| Feature | Needs |
|---|---|
| Media upload | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (Cloudflare dashboard) |
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — see [google-oauth-setup.md](./google-oauth-setup.md) |
| Activation emails | `MAIL_DRIVER=console` writes the link to the Wrangler stdout — no SMTP needed |
| Staging / production targets | `pnpm --filter api exec wrangler login` |

---

## 3. Seed accounts

Created by `make db-seed-local`, which `setup` runs for you. The seed is
idempotent — running it twice produces no duplicates.

| Role | Email | Password |
|---|---|---|
| Admin | `admin@arenaquest.dev` | `Admin1234!` |
| Student | `student@arenaquest.dev` | `Student1234!` |
| Professor | `professor@arenaquest.dev` | `Professor1234!` |

> **Local only.** These accounts must never reach staging or production. The
> deploy targets run `apps/api/scripts/check-no-dev-seed.ts` against the target
> database first and abort if the dev-seed password hash is found there.

To create a *real* admin (on any environment, including remote), use the
interactive `make bootstrap-admin` instead — but see Known Issues below first.

---

## 4. The naming rule

This is the one thing worth internalising. Run `make help` and you will see it
in the header:

> **An unsuffixed target is always local. A target that touches a deployed
> environment names that environment in its own name.**

```bash
make dev                  # local
make test                 # local
make db-migrate-local     # local D1 replica

make db-migrate-staging   # REMOTE staging database
make deploy-staging       # staging

make db-migrate-prod      # REMOTE production database — asks you to confirm
make deploy-prod          # production — asks you to confirm
```

Three corollaries:

1. **`-api`, `-web` and `-shared` are scope, not environment.** `make lint-api`
   lints `apps/api`; it has nothing to do with where anything is deployed.
2. **There is no implicit production.** Every `-prod` target requires you to
   type `production` at a prompt. `CONFIRM=1` bypasses it for scripted use.
3. **`make deploy`, `make deploy-api` and `make deploy-web` no longer exist.**
   They used to mean production, silently. They now fail with a message
   pointing at `-staging` / `-prod`.

### Renamed targets

The old names still work and print a pointer to the new one. They will be
removed eventually — prefer the new names in new code and docs.

| Old | New |
|---|---|
| `db-migrations-dev` | `db-migrate-local` |
| `db-seed-dev` | `db-seed-local` |
| `db-migrations-staging` | `db-migrate-staging` |
| `db-migrations-prod` | `db-migrate-prod` |
| `create-db`, `create-kv`, `list-kv` | `create-db-prod`, `create-kv-prod`, `list-kv-prod` |
| `r2-cors-dev` | *(removed — it named a bucket that exists in no config)* |

---

## 5. Troubleshooting

Start with `make doctor`. It exits `0` when clean, `1` on a hard gap (the stack
will not run), and `2` when only optional items are outstanding — the same
exit-code contract as `make label-check`. Every failure prints the target that
fixes it.

**Not logged in to wrangler.** Expected, and never a hard gap. Local
development is fully offline. Only run `wrangler login` when you need
staging or production.

**Sticky 401 after ~15 minutes, often mid-form.** Check `COOKIE_SAMESITE=Lax`
in `apps/api/.dev.vars`. The default of `None` is issued as
`SameSite=None; Secure`, which browsers refuse to store over plain
`http://localhost` — the silent token refresh then fails once the 15-minute
access token expires. `make doctor` flags this.

**All requests 404 with a doubled path (`/v1/v1/...`).** `NEXT_PUBLIC_API_URL`
in `apps/web/.env.local` must be a bare origin. `api-client.ts` injects the
`/v1` prefix itself. `make doctor` flags this too.

**Local database is in a bad state.**

```bash
make db-reset-local     # deletes the replica, re-migrates, re-seeds
```

**Port 3000 or 8787 already taken.** `make doctor` reports it. Find the holder
with `lsof -i :8787`.

**CORS errors from the browser.** `ALLOWED_ORIGINS` in `.dev.vars` must include
`http://localhost:3000`. The `*` full-wildcard form works locally but must
never be set in staging or production — see `CLAUDE.md` for the full policy.

---

## 6. Known issues

Pre-existing problems found while writing this guide. They are documented
rather than fixed, so they do not block you unexpectedly.

1. **`make bootstrap-admin` is broken.** `scripts/bootstrap-first-admin.sh`
   calls `pnpm run --silent gen-hash` in `apps/api`, but no `gen-hash` script is
   defined in `apps/api/package.json` — `apps/api/scripts/gen-hash.ts` exists
   but is unreachable. The script dies with "gen-hash returned empty output".
   For local work, use the seed accounts instead.
2. **That same script hashes at 210 000 PBKDF2 iterations**, while the Workers
   runtime caps `deriveBits` at 100 000 (`jwt-auth-adapter.ts:47`) and every
   seeded hash uses `pbkdf2:100000:`. A bootstrapped admin may be unable to
   log in even once issue 1 is fixed.
3. **Two divergent dev seeds exist** —
   `apps/api/migrations/seed/0001_test_users.sql` (the one `db-seed-local` uses,
   and the one documented here) and `apps/api/scripts/dev/0004_seed_dev_users.sql`,
   which is referenced by nothing.
4. **`db-migrations-staging-local`** (staging schema against a local replica)
   has no identified caller. It is kept but omitted from `make help`.

---

## See also

- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — branch strategy, commit style, PR flow
- [`CLAUDE.md`](../CLAUDE.md) — architecture, conventions, CORS policy
- [`docs/google-oauth-setup.md`](./google-oauth-setup.md) — Google sign-in setup
- `make help` — the authoritative command list
