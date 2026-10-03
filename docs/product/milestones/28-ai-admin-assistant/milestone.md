# Milestone 28 — AI Admin Assistant

**Status:** 📝 Draft
**Scope:** `scripts/backup/` + `.github/workflows/backup.yml` + the label profile and provisioner (off-database backups of D1 and R2, restore drill, backup status), `apps/api` (`job_runs` recording, admin ops health and job-run routes, admin-only topic publish gate), `apps/web` (topic publish controls follow the gate), `scripts/lib/` + `scripts/mcp/` (shared API client, the local `aq-mcp` MCP server), `.claude/skills/ops-runbook/` and `docs/operations/`. Derived from [RFC 0025](../../RFCs/0025-ai-admin-assistant.md).

> **Hard scope guardrail — read before opening any task.** This milestone may touch **only**: the new `scripts/backup/**`, `scripts/lib/**`, `scripts/mcp/**` and `.github/workflows/backup.yml`; `scripts/content/import-media.mjs` and `scripts/media/convert-skipped.mjs` **only** to import what moves to `scripts/lib/` (behaviour and CLI unchanged, their existing tests green and unedited except for import paths); `scripts/cloudflare/provision-label.mjs` for the backup bucket and a read-only `--check` mode; the `backup` block in `config/labels/*.jsonc` and the profile schema that validates it; one new migration `apps/api/migrations/00NN_create_job_runs.sql` (next free number at implementation time — `0031` is claimed by M27); `apps/api/src/index.ts` (`scheduled()` recording), `apps/api/src/core/billing/billing-service.ts` (return counts only), `apps/api/src/jobs/**`, the new `apps/api/src/routes/admin/ops.ts`, `apps/api/src/controllers/admin-ops.controller.ts`, a `D1JobRunRepository` with its port in `packages/shared/ports/`, the wiring lines in `routes/admin/index.ts` and `container.ts`, the publish gate in `apps/api/src/routes/admin/topics.ts`, `apps/api/test/**`, the regenerated `apps/api/openapi.json` and `apps/web/src/lib/api-types.gen.ts`; the topic publish controls under `apps/web/src/app/(protected)/admin/topics/**` and `apps/web/src/components/admin/topics/**` with both i18n dictionaries; the root `package.json`/lockfile for `@modelcontextprotocol/sdk` only; the new `.claude/skills/ops-runbook/**`, `docs/operations/backup-restore.md`, the `aq-mcp` section of `docs/onboarding.md`, a CLAUDE.md paragraph per new surface; the `Makefile` for new `backup-*-prod`, `backup-status-prod` and `infra-check-<env>` targets only; `.gitignore` only for `.arenaquest/` if not yet ignored; and, for the closeout, RFC 0025's `Status:` header and its README row. It is explicitly **not** an opportunity to: build a **remote MCP server** in the Worker or any OAuth flow (RFC Alternative 1); let the assistant **publish, archive, delete or move** topics; write to D1 through **SQL** from any tool; let any tool **restore, reset or deploy** — tier 3 only prints the command; back up **staging** or **KV**, or store **secret values** anywhere; add **multi-operator** access or a new role; change the public, anonymous **`/health`**; touch **`topic_notes` bodies** or **submission files** from any tool. If a refactor opportunity is spotted outside this scope, file a separate task — do not bundle it.

---

## 1. Objectives

- **Every production label has an off-database backup it can prove.** A daily gzipped D1 dump with SHA-256 and row counts, an incremental R2 mirror that keeps deleted objects for 90 days, and a weekly restore drill whose result lands in the manifest (RFC §4.1–§4.4).
- **"Was a backup made, and what do I do if not?" has a factual answer.** `scripts/backup/status.mjs` reports dump age, size delta, drill result, mirror lag, Time Travel window and the off-account gap — each non-green line with the command that fixes it (RFC §4.5).
- **A restore can be performed from the runbook alone.** `docs/operations/backup-restore.md` covers Time Travel, dump restore and R2 copy-back (RFC §4.6).
- **Scheduled jobs leave a record.** `job_runs` gets one row per billing and sweep execution, cron or manual, including failures and empty days (RFC §3.1).
- **Health is measured, not asserted.** `GET /v1/admin/ops/health` probes D1, KV and R2 and reports the last run of each job; `GET /v1/admin/ops/job-runs` lists runs (RFC §3.2).
- **Publishing a topic is an admin act.** The API refuses `status: 'published'` from a `content_creator` on create and update, and the backoffice stops offering it to them (RFC §2, layer 3).
- **The operator can author drafts with an AI from any machine with the repo.** `aq-mcp` lists, reads, creates and edits draft topics, reads comments, and uploads local media (converting `.mov`) through the public API, with an audit log (RFC §2, §7).
- **Ops and backup questions go through tiered tools.** Tier 1 diagnoses freely on a read-only Cloudflare token, tier 2 acts only after a confirmed plan, tier 3 returns the command and never runs it (RFC §5).
- **Ad-hoc SQL questions have a runbook.** The `ops-runbook` skill: schema map, canned `SELECT`s, computed predicates and the data-exposure rules (RFC §3.3, §3.4, §6).

Out of scope (explicit, from RFC 0025 Non-Goals):
- **Remote MCP in the Worker / claude.ai / phone access** — deferred, RFC Alternative 1; needs OAuth without external auth deps.
- **Publish, archive, delete or move from the assistant** — the operator does these in the backoffice.
- **SQL writes** — RFC Alternative 2; content writes go through the API.
- **Restores executed by the assistant** — the runbook is for a human (tier 3).
- **Staging and KV backups** — staging is disposable (RFC 0021 §4); KV holds rate-limit counters.
- **Secret values** — write-only in Cloudflare; only presence by name is reported.
- **Multi-operator access** — a future RFC if tutors or creators want the assistant.
- **Off-account backup copy** — deferred (Decision 3); the status report flags it.
- **Daily brief routine (RFC Phase 5)** — optional; a backlog item after this milestone closes.

---

## 2. Functional Requirements

**Backups (Plane C)**
- A scheduled workflow exports each production label's D1 daily and writes `d1/production/YYYY/MM/DD/<ts>.sql.gz` plus `manifest.json` to the label's backup bucket; the manifest entry carries timestamp, bytes, SHA-256, per-table row counts and the export duration.
- Lifecycle keeps daily dumps 35 days and the first dump of each month 12 months.
- The R2 mirror copies every source object whose key or ETag is missing in the backup bucket; it never deletes on the first pass; objects gone from the source are marked with their removal date and pruned after 90 days.
- A weekly drill restores the latest dump into a throwaway local D1, compares row counts with the manifest, and records `drill: { at, ok, mismatches }`.
- The backup bucket is declared in the label profile and created by `provision-label.mjs`; `provision-label.mjs --check` reports resource presence and secret names without writing anything.
- `status.mjs` reports the items of §1 and prints a fix command for each non-green item; a backup without a passing drill is reported as unverified.

**Observability (Plane B)**
- Each billing run and each submission sweep writes a `job_runs` row: `running` on start, then `ok` or `failed` with JSON counts or a truncated error. A failing billing run still records `failed` and the sweep still runs. A `job_runs` write failure never fails the job.
- `POST /v1/admin/billing/invoices/run` records `trigger = 'manual'`.
- The daily run prunes `job_runs` rows older than 180 days.
- `GET /v1/admin/ops/health` (admin, content creator) returns per-dependency `ok | degraded | down` with latency, the latest applied migration, and the last run per job with its age. The anonymous `/health` is unchanged.
- `GET /v1/admin/ops/job-runs?job=&since=` lists runs newest first.

**Publish gate**
- `POST /v1/admin/topics` and `PATCH /v1/admin/topics/{id}` with `status: 'published'` answer `403` to a `content_creator` and succeed for an `admin`; `draft` and `archived` stay open to both.
- The backoffice hides or disables the publish action for a session without `admin` and shows the API's refusal if one arrives anyway (the events `PublishControls` pattern), in both languages.

**`aq-mcp` (Planes A and C)**
- Runs as a stdio MCP server: `node scripts/mcp/aq-mcp.mjs --label <l> -e <env>`, credentials from `AQ_ADMIN_EMAIL` / `AQ_ADMIN_PASSWORD` (a dedicated `content_creator` account) and `AQ_CF_READ_TOKEN`; `AQ_API_BASE_URL` only towards loopback.
- Authoring tools: `list_topics`, `read_topic`, `topic_comments`, `create_topic_draft` (no status parameter), `update_topic_draft` and `upload_media` (both refused unless the topic is `draft`), `review_link`.
- `upload_media` validates against `limits.ts`, converts `.mov` through the shared converter, uploads through `presign → PUT → finalize`, and reports a missing `ffmpeg` with its install command.
- Ops tools: tier 1 `system_health`, `job_runs`, `backup_status`, `time_travel_status`, `infra_status`; tier 2 `backup_now`, `bookmark_now` through a two-call confirmation (single-use id, 5-minute expiry); tier 3 `restore_instructions` returns the command and runbook section only.
- Every tool carries `readOnlyHint` / `destructiveHint` annotations; every call appends a line to `.arenaquest/mcp-audit-<label>-<env>.jsonl` without content bodies.
- No tool returns private note bodies, submission files, password hashes, refresh tokens or secret values.

---

## 3. Acceptance Criteria

- [ ] Running `backup.yml` by `workflow_dispatch` for every label produces a dump and a manifest entry in each production backup bucket; the SHA-256 in the manifest matches the stored object.
- [ ] The weekly drill restores the latest dump into a throwaway D1 with zero row-count mismatches, and `drill.ok: true` appears in the manifest.
- [ ] On a staging copy, deleting a media object and following `docs/operations/backup-restore.md` restores it byte-identical from the mirror.
- [ ] `node scripts/backup/status.mjs --label budo -e production` prints dump age, drill, mirror lag, Time Travel window and "off-account copy: missing" with its fix line.
- [ ] `provision-label.mjs --check` performs no write call (asserted by its tests) and lists the backup bucket among required resources.
- [ ] A forced billing failure in a Workers test leaves one `failed` billing row and one `ok` sweep row; a day with nothing to bill leaves an `ok` row with zero counts.
- [ ] `GET /v1/admin/ops/health` returns `down` for a dependency whose binding throws (test double), and `401`/`403` for anonymous and student callers.
- [ ] A `content_creator` gets `403` publishing a topic through `POST` and through `PATCH`; an admin gets `200`/`201`; `archived` by a content creator still succeeds.
- [ ] Logged in as `content_creator`, the topics backoffice offers no publish action; as `admin` it does.
- [ ] From a clean clone on a second machine, `claude mcp add … aq-mcp.mjs --label <l> -e staging` exposes the tools; creating a draft with a local `.mov` and two photos yields a `draft` topic with three `ready` media visible in the backoffice.
- [ ] No `aq-mcp` tool schema accepts a topic status, and calling `update_topic_draft` / `upload_media` on a published topic is refused before any API write.
- [ ] `backup_now` without its confirmation id performs no export; with an expired id it is refused.
- [ ] A static test asserts that `scripts/mcp/**` never spawns `wrangler` with `d1 time-travel restore`, `d1 execute`, `deploy`, `delete` or `secret put`.
- [ ] `import-media.mjs` and `convert-skipped.mjs` test suites pass unchanged after the extraction to `scripts/lib/`.
- [ ] `make lint`, `make test-api` and `make test-web` pass; the scripts' `node --test` suites pass.
- [ ] No diff outside the paths listed in the scope guardrail.

---

## 4. Specific Stack

- **Backups:** GitHub Actions (cron, `strategy.matrix.label` like the deploy workflow, Node 22 for wrangler); `wrangler d1 export --remote`; R2 through its S3-compatible API (signing library chosen in the mirror task); R2 lifecycle rules on the backup bucket; the drill reuses the *Demo seed check* throwaway-D1 mechanism.
- **Scripts:** plain Node ESM (`.mjs`), stdlib plus what the repo already uses; `node --test` beside each script, as `import-media.test.mjs` does.
- **MCP:** `@modelcontextprotocol/sdk` (stdio transport) as a root dev dependency; Zod for tool input schemas; no auth dependency is added.
- **Backend:** Cloudflare Workers + Hono; `@hono/zod-openapi` `createRoute` with `respondWith`; controllers return `ControllerResult<T>`; per-request adapters built in `buildContainer(env)`; new D1 repository behind a `packages/shared/ports` interface.
- **Frontend:** Next.js 15 App Router, React 19, Tailwind v4; both dictionaries; `check-i18n-coverage.js`; the events `PublishControls` as the pattern.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` (API); Vitest + RTL (web); `node --test` (scripts).

---

## 5. Task Breakdown

Each row is one independent PR. Backend and frontend are separate files; every
script/CI task is filed under **Backend** (the only non-web team).

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [Backup bucket in the label profile and provisioner check mode](./01-backup-bucket-and-provision-check.task.md) | 0 | Backend | ☐ Open |
| 02 | [D1 export and backup manifest](./02-d1-export-and-manifest.task.md) | 0 | Backend | ☐ Open |
| 03 | [R2 media mirror](./03-r2-media-mirror.task.md) | 0 | Backend | ☐ Open |
| 04 | [Backup workflow, restore drill and restore runbook](./04-backup-workflow-drill-and-runbook.task.md) | 0 | Backend | ☐ Open |
| 05 | [Record scheduled and manual job runs](./05-job-runs-recording.task.md) | 1 | Backend | ☐ Open |
| 06 | [Admin ops health and job-runs API](./06-admin-ops-health-api.task.md) | 1 | Backend | ☐ Open |
| 07 | [Admin-only topic publish gate](./07-topic-publish-gate.task.md) | 2 | Backend | ☐ Open |
| 08 | [Topic publish controls follow the role](./08-topic-publish-controls.task.md) | 2 | Frontend | ☐ Open |
| 09 | [Shared script library for the API client and media conversion](./09-shared-script-library.task.md) | 3 | Backend | ☐ Open |
| 10 | [aq-mcp server with draft authoring tools](./10-aq-mcp-authoring-tools.task.md) | 3 | Backend | ☐ Open |
| 11 | [Backup status report](./11-backup-status-report.task.md) | 4 | Backend | ☐ Open |
| 12 | [aq-mcp ops tools in three tiers](./12-aq-mcp-ops-tools.task.md) | 4 | Backend | ☐ Open |
| 13 | [ops-runbook skill and read-only token procedure](./13-ops-runbook-skill.task.md) | 4 | Backend | ☐ Open |

Dependency graph (an arrow means "must land before"):

```
Phase 0   01 ──► 02 ──┐
          01 ──► 03 ──┴──► 04 ──► 11 ──┐
Phase 1   05 ──► 06 ───────────────────┤
Phase 2   07 ──► 08                    ├──► 12 ──► 13
Phase 3   07, 09 ──► 10 ───────────────┤
          01 (--check) ────────────────┘
          05 (job_runs) ─────────────────────────► 13
```

**Recommended execution order:** `01` → `02` → `03` → `04` → `05` → `06` → `07` → `08` → `09` →
`10` → `11` → `12` → `13`. Three independent starts — `01` (backups), `05` (observability),
`07`/`09` (publish gate, script library) — may run in parallel; `07` waits on the owner's
confirmation of Decision 6.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing (and `node --test` for the
script suites it touches).

---

## 6. Decisions recorded (from RFC 0025)

RFC 0025 has no Resolved Decisions yet. Decisions 1–4 below come from the
design itself. Decisions 5–10 are the **recommended defaults** for its Open
Questions, recorded here so tasks can be written; they are **pending
confirmation by raphaelsilva** and must be confirmed (and moved into the RFC's
"Resolved Decisions" with a date) before Phase 2 or Phase 3 starts.

1. **Writes go through the public API only** — no tool writes D1 through SQL; this keeps `sanitizeMarkdown`, `sort_order`, tags, limits and the R2 lifecycle in one place (RFC Alternative 2).
2. **No generic shell or `wrangler` tool** — tools wrap the existing guarded CLIs; one release and provisioning path (RFC Alternative 3).
3. **Tier 3 is enforced by credentials** — `aq-mcp` loads only `AQ_CF_READ_TOKEN`; tier 2 uses the operator's own `wrangler login` after confirmation; the CI write token never reaches a workstation (RFC §5).
4. **Backups are Phase 0** — they close a data-loss risk whether or not the assistant ships (RFC §Implementation Plan).
5. **Installation = clone the repo** *(pending)* — `claude mcp add … node scripts/mcp/aq-mcp.mjs`; no `npx` package in this milestone (RFC OQ 1).
6. **Topic publishing becomes admin-only for every `content_creator`** *(pending — verify no real content creator publishes topics today on Budo, Spaziord or ArenaQuest)*; if one does, the gate falls back to the assistant's account only (RFC OQ 2).
7. **Published topics are not editable by the assistant** *(pending)* — no revision model in this milestone (RFC OQ 3).
8. **Off-account copy deferred** *(pending)* — backups go to a separate bucket in the same account; the status report flags the gap (RFC OQ 4).
9. **Private notes are never exposed** *(pending)* — shared notes and metadata only (RFC OQ 6).
10. **Claude Code is the supported client** *(pending)* — Claude Desktop may work over stdio but is not tested here (RFC OQ 7).

RFC OQ 5 (can a D1-read token run `SELECT` through the query endpoint?) is
answered by the implementer of the Phase 4 runbook task; the answer decides
whether Plane B moves into an `aq-mcp` `query` tool.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Every production label shows a passing drill less than 8 days old in its manifest.
- [ ] Decisions 5–10 confirmed by the owner and recorded as Resolved Decisions in RFC 0025.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC 0025 status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items (remote MCP, off-account copy, daily brief) remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
