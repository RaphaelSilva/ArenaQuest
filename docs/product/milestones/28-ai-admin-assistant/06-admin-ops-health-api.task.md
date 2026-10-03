# Task 06 — Backend: Admin ops health and job-runs API (Phase 1)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Backend API
**Depends On:** [Task 05](./05-job-runs-recording.task.md)

## Summary

Adds the admin operations surface: `GET /v1/admin/ops/health` and
`GET /v1/admin/ops/job-runs`, open to `admin` and `content_creator` (the admin umbrella), never
to students, tutors or anonymous callers. Health **measures** instead of asserting: a trivial
D1 read, a KV read of a fixed key, an R2 head of a fixed key, the latest applied migration, and
the latest `job_runs` row per job with its age; each dependency answers `ok`, `degraded` (slow,
above a stated threshold) or `down` (threw), with its latency, and the overall status is the
worst of them. Each probe has a short timeout so one hung binding cannot hang the response.
Job-runs lists rows newest first, filterable by `job` and `since`, bounded by a limit. The
anonymous `/health` is unchanged — it must not leak internals. Task 12 wraps both as
`system_health` and `job_runs` tools.

## Dependencies

- [Task 05](./05-job-runs-recording.task.md) — hard dependency: the `job_runs` port.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/controllers/admin-ops.controller.ts` — new.
  - `apps/api/src/routes/admin/ops.ts` — new, `createRoute` + `respondWith`.
  - `apps/api/src/routes/admin/index.ts` — one mount line.
  - `packages/shared/ports/**` — a read method on the job-run port if Task 05 did not add it, and
    a minimal health-probe method on existing ports only if no existing read can serve as probe.
  - `apps/api/src/openapi/components/entities.ts` and the regenerated `apps/api/openapi.json`.
  - `apps/api/test/**`.
- **Read-only.** Probes never write: no KV put, no R2 put, no D1 write.
- **Ports & Adapters.** The controller probes through ports; no D1/KV/R2 symbol in the controller.
- **Bounded.** Per-probe timeout and a capped `limit` on job-runs; malformed `since` is `400`.
- **No secrets or internals** beyond dependency names, latencies, migration name and job rows.

## Scope

In:
- Controller, routes, schemas, OpenAPI regeneration, tests for every status and role.

Out:
- Changing the public `/health`.
- Any UI page — the backoffice does not show this in this milestone.
- Frontend.

## Acceptance Criteria

- [ ] With all bindings healthy, `GET /v1/admin/ops/health` returns `ok` for D1, KV and R2, the
      latest migration name, and the last billing and sweep rows with their ages.
- [ ] A test double whose R2 head throws makes R2 `down` and the overall status `down`; a slow
      double beyond the threshold makes it `degraded`; the response still arrives within the
      timeout.
- [ ] No write is issued to any binding during a health call (asserted).
- [ ] `GET /v1/admin/ops/job-runs?job=billing&since=…` returns only matching rows, newest first;
      an invalid `since` returns `400`.
- [ ] Anonymous → `401`; `student` and `tutor` → `403`; `admin` and `content_creator` → `200`.
- [ ] `openapi.json` regenerated; `make lint` and `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — ops specs.
2. `make dev-api`; call both routes with an admin token, then with a student token.
3. `git diff --stat` confirms only scope-guardrail files changed.
