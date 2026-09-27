# Task 01 — Tooling: `make db-reset-local` leaves stale workerd state, and the API then refuses to start

**Status:** 📝 Open
**Team:** Backend API
**Found in:** Milestone 20, Task 08, 2026-09-22

## Summary

`make db-reset-local` deletes only `apps/api/.wrangler/state/v3/d1`. The sibling
directories — `cache/`, `kv/`, `r2/`, `workflows/` — survive, and they are written by
whichever `workerd` version last ran.

After a reset against state left by an older workerd, `wrangler dev` crashes on startup:

```
*** Fatal uncaught kj::Exception: table _cf_ALARM has 3 columns but 2 values were supplied
```

The API does not start at all. `rm -rf apps/api/.wrangler/state` fixes it.

## Why it is worth fixing rather than documenting

The failure names an internal Cloudflare table, points at no command, and gives no hint
that **the documented reset command is the thing that did not reset.** A new contributor
following `docs/onboarding.md` hits an API that will not boot, immediately after running
the command whose entire purpose is to return them to a clean state — the worst possible
moment for an error message that explains nothing.

It is also self-inflicted: the target promises "delete the local replica, re-migrate and
re-seed", and a reader reasonably reads that as "start clean".

## Scope

In:
- Widen `db-reset-local` to clear the whole local worker state, or at least the
  version-sensitive directories, rather than `v3/d1` alone.
- Keep it local-only and idempotent; no change to `db-migrate-local` or `db-seed-local` on
  their own.
- A line in `docs/onboarding.md`'s known-issues section for anyone on an older checkout.

Out:
- Anything touching remote D1 or the deploy path.

## Acceptance Criteria

- [ ] After `make db-reset-local`, `make dev-api` starts cleanly on a tree whose
      `.wrangler/state` was written by an older `workerd`.
- [ ] Running it twice in a row still succeeds and leaves a migrated, seeded replica.
- [ ] `make doctor` passes afterwards.
