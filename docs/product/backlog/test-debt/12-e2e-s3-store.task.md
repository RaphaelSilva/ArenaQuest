# Task 12 — Tooling: Ephemeral S3 store for E2E runs

**Status:** 📝 Open
**Kind:** Chore
**Team:** Tooling
**Priority:** Medium
**Found in:** Backlog test-debt, Task 11 (E2E scaffold), 2026-11-06

## Summary

Local development has no object store that answers the S3 wire protocol:
`apps/api/.dev.vars.example` expects real R2 credentials for `R2_ACCESS_KEY_ID`
/ `R2_SECRET_ACCESS_KEY`, and the API's Vitest config points `R2_S3_ENDPOINT`
at `http://localhost:4566` where nothing listens (the presigned URL is only ever
generated there, never used). An end-to-end upload — a real browser doing the
`PUT` that `R2StorageAdapter.getPresignedUploadUrl` signed — therefore has
nowhere to go without touching a Cloudflare account.

Target state: `e2e/` provides an S3-compatible store that exists only for the
duration of a run, in two interchangeable modes behind one variable,
`E2E_S3_MODE`:

- **`docker`** (default when a daemon answers) — a SeaweedFS container from
  `e2e/docker-compose.yml`, no volume, so it is empty on every `up` and gone on
  `down`. This is the fidelity mode: SigV4 presigned `PUT` from the browser,
  CORS preflight, path-style addressing, `HeadObject` / `ListObjectsV2` on the
  wire, exactly the calls R2 answers in production.
- **`embedded`** — a stdlib-only Node server, `e2e/s3/embedded-server.mjs`,
  started in-process by Playwright's `globalSetup` on an ephemeral port with a
  temporary directory as its store. It is the mode for hosts without a Docker
  daemon (a Claude Code cloud session has the CLI and no daemon, and cannot
  download a release binary either), and the fastest mode for a local loop.
- **`skip`** — no store; the `s3` fixture of Task 11 marks every upload spec
  as *skipped* with that reason. Never a silent pass.

The product does not change: the Worker keeps signing against whatever
`R2_S3_ENDPOINT` says, which in E2E is one of the two stores above.

## Why It Is Worth Fixing

- Scenario 8 of Task 11 (authoring to consumption, with media) and scenario 15
  (submissions) cannot exist without a store; every other E2E journey can.
- The alternative — a shared test bucket on the Cloudflare account with its keys
  as CI secrets — is not ephemeral (runs would see each other's objects), costs
  a secret in the `e2e` job, and would be the first non-local target a `make`
  target without an environment suffix ever reaches, against the Makefile rule.
- Container-only (API and web in Compose too) was considered and rejected for
  now: the Node apps are already ephemeral through `wrangler dev --persist-to` on
  a temp dir, so containerising them buys nothing except an image build on every
  CI run (several minutes without a warm layer cache) and a second `next build`.
  Only the component that is *not* a Node process is containerised. A
  `--profile full` Compose can be added later if someone needs the whole stack
  in Docker.

## Design

**SeaweedFS** (`chrislusf/seaweedfs`, tag pinned) runs as one
`weed server -s3 -s3.port=8333 -dir=/data` process with a static identity file
(`e2e/s3/identities.json`: one access key / secret pair, test-only values that
`e2e/.env.e2e` repeats for the Worker). Chosen over MinIO because the single
process needs no console, no licence prompt and takes a per-bucket CORS
configuration; the choice is one image line in the compose file and is not a
commitment. The compose service has a `healthcheck` on the S3 port so
`docker compose up -d --wait` returns only when it answers.

**Preparation** (`e2e/s3/prepare.mjs`, run by `globalSetup` in both modes):
`CreateBucket` for `e2e-media`, then `PutBucketCors` allowing origin
`http://localhost:3000`, methods `PUT`, `GET`, `HEAD`, every request header, and
`ETag` exposed — the same rule `provision-label.mjs` derives for R2 from the
profile's `webOrigin`, so the preflight the browser sends in E2E is the one it
sends in production. It uses `@aws-sdk/client-s3`, already a root devDependency.

**Embedded server** implements only what the adapter, Task 13's adapter and the
browser use: `PUT`/`GET`/`HEAD`/`DELETE` object, `POST ?delete` (DeleteObjects),
`GET ?list-type=2` with `prefix`, `max-keys` and `continuation-token`, `Range`
on `GET`, `OPTIONS` preflight answered from the same CORS rule, `aws-chunked`
bodies decoded and `x-amz-checksum-*` headers accepted. A presigned URL is
checked for the presence of `X-Amz-Signature` and an unexpired `X-Amz-Date` +
`X-Amz-Expires`; the signature itself is **not** verified. That limit is written
at the top of the file and in `docs/onboarding.md`: `embedded` proves the
lifecycle, `docker` proves the signature. The server has its own
`node --test e2e/s3/embedded-server.test.mjs` (wired into `make test-scripts`)
covering the subset, range reads, pagination and the CORS answer.

**Mode selection** lives in `e2e/s3/mode.mjs`: `E2E_S3_MODE` wins when set;
otherwise `docker` if `docker info` exits 0 within 5 s, else `embedded`. The
resolved mode, endpoint and bucket are printed once at the start of the run and
exported to the API `webServer` as `R2_S3_ENDPOINT` / `R2_BUCKET_NAME` /
`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`.

**CI.** GitHub's `services:` block cannot pass a container command, and
SeaweedFS needs one, so the `e2e` job runs
`docker compose -f e2e/docker-compose.yml up -d --wait` as a step before
`make e2e`, and `down -v` in an `if: always()` step after. `ubuntu-latest`
ships Docker; nothing is installed.

## Scope

In:
- `e2e/docker-compose.yml`, `e2e/s3/identities.json`, `e2e/s3/prepare.mjs`,
  `e2e/s3/mode.mjs`, `e2e/s3/embedded-server.mjs` and its `node:test` spec.
- `Makefile`: `e2e-s3-up` / `e2e-s3-down` helpers used by `e2e*` and the
  `test-scripts` entry for the embedded server spec.
- The two CI steps around `make e2e` in the `e2e` job.
- The *S3 store modes* subsection of `docs/onboarding.md`'s E2E section.

Out:
- Containerising `apps/api` or `apps/web` (see Why, third bullet).
- Any change to `R2StorageAdapter` or to the Worker's bindings — that is Task 13.
- Verifying SigV4 in the embedded server.
- Using either store from `make dev-api`: local development keeps its
  `.dev.vars` contract; a developer who wants the embedded store for manual
  testing can start it by hand (`node e2e/s3/embedded-server.mjs --port 8333`),
  documented but not wired.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/docker-compose.yml`, `e2e/s3/**`
  - `Makefile` (`e2e-s3-*` targets and the `test-scripts` list only)
  - `.github/workflows/ci.yml` (the `e2e` job only)
  - `docs/onboarding.md`
- No behaviour change under `apps/**` or `packages/**`.
- Test-only credentials: the identity file and `.env.e2e` values are fixed
  strings that never match a real key; `check-no-dev-seed` is not involved
  because no database is touched.
- The container publishes its port on `127.0.0.1` only, and the embedded server
  binds `127.0.0.1` only.
- No volume, no bind mount, no `restart:` policy: the store must not survive
  `down`.

## Acceptance Criteria

- [ ] `E2E_S3_MODE=docker make e2e-desktop` on a machine with Docker: scenario 8
      passes, and `docker compose ps` shows the service healthy; after
      `make e2e-s3-down`, `docker volume ls` shows nothing new.
- [ ] `E2E_S3_MODE=embedded make e2e-desktop` passes the same scenario with no
      Docker daemon reachable (verified by running it where `docker info` fails).
- [ ] With neither variable nor daemon, the run prints `s3: embedded` and
      proceeds; with `E2E_S3_MODE=skip` it prints `s3: skip` and the upload
      spec is reported *skipped*.
- [ ] The browser's `PUT` in `docker` mode is preceded by an `OPTIONS` answered
      `200` with `Access-Control-Allow-Origin: http://localhost:3000` (visible in
      the Playwright trace's network tab).
- [ ] A presigned URL with `X-Amz-Expires` already elapsed is refused by both
      modes (`403`), and a `PUT` whose body is longer than the signed
      `Content-Length` is refused in `docker` mode.
- [ ] `node --test e2e/s3/embedded-server.test.mjs` green and part of
      `make test-scripts`.
- [ ] The CI `e2e` job's store steps add under 30 s to the job.
- [ ] `make lint` and `make test` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-scripts` — the embedded server spec passes with the rest.
2. Run scenario 8 under each of the three modes as listed above and keep the
   three report outputs.
3. Demonstrate the guard: stop the container mid-run and confirm the spec fails
   with a connection error, not a timeout on a false positive; restart, re-run.
4. In CI, read the step timings of the `e2e` job on the PR.
5. `git diff --stat` confirms only scope-guardrail files changed.
