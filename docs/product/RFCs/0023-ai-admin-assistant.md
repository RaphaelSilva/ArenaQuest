# RFC 0023: AI Admin Assistant: Content Authoring, Operational Queries and Backups

**Date:** 2026-10-02
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `scripts/mcp/` (new — the local `aq-mcp` MCP server: content authoring and ops tools over the public API and the backup manifest)
- `scripts/lib/api-client.mjs` (new — the API client, retry and upload lifecycle extracted from `scripts/content/import-media.mjs`, shared by the importer and the MCP server)
- `scripts/content/import-media.mjs` (imports the extracted client instead of owning it; behaviour unchanged)
- `scripts/backup/` (new — `export-d1.mjs`, `mirror-r2.mjs`, `drill.mjs`, `status.mjs`)
- `.github/workflows/backup.yml` (new — scheduled D1 export, R2 mirror and weekly restore drill per label)
- `apps/api/migrations/00NN_create_job_runs.sql` (new — one row per scheduled/manual job execution)
- `apps/api/src/index.ts` (`scheduled()` records each job in `job_runs`)
- `apps/api/src/core/billing/billing-service.ts` (`runScheduledBilling` returns its counts so they can be recorded)
- `apps/api/src/routes/admin/topics.ts` (a `publishGate` equivalent: publishing a topic becomes admin-only)
- `apps/api/src/routes/admin/ops.ts` + `apps/api/src/controllers/admin-ops.controller.ts` (new — `GET /v1/admin/ops/health`, `GET /v1/admin/ops/job-runs`)
- `.claude/skills/ops-runbook/SKILL.md` (new — schema map, canned read-only queries, privacy rules)
- `config/labels/<label>.jsonc` (a `backup` block: bucket name and retention)
- `docs/operations/backup-restore.md` (new — the restore runbook the assistant points to but never executes)

---

## Summary

Give the site's operator an AI assistant (Claude Code, on the operator's own
computer) that can **author content**, **answer operational questions** and
**report on backups and infrastructure**, without ever being able to publish,
destroy or restore anything by itself. It is delivered as a local MCP server,
`aq-mcp`, that talks to the system only through paths that already exist and
are already guarded: the public API for content, the label deploy/provision
CLIs for infrastructure facts, and a new backup manifest for backup state.
Raw SQL is kept for read-only questions only. The most important consequence
is not the assistant itself: answering "was a backup made?" forces the system
to **actually take off-database backups** of D1 and R2, which it does not do
today.

## Motivation

The day-to-day operation of a label (Budo, Spaziord, ArenaQuest) is a set of
small recurring questions and chores, today answered by opening the
backoffice, the Cloudflare dashboard or a terminal:

| Case | Today | Covered by this RFC? |
|---|---|---|
| Write the "Welcome" topic with a video and photos stored on the operator's personal computer | Backoffice by hand, one upload at a time | ✅ Plane A — draft authoring + local media upload |
| Read what a topic contains, reorganise or rewrite it | Backoffice | ✅ Plane A — read tools; edits on drafts only |
| "Summarise the comments on topic X since Monday" | Read every comment in the UI | ✅ Plane A (`topic_comments`) / Plane B (SQL) |
| "Did today's billing run? Did it generate the boletos?" | Infer from `invoices`; a day with nothing to bill looks like a failed run | ✅ Plane B — `job_runs` |
| "Did student Y do anything this week?" | Ad-hoc SQL in the dashboard | ✅ Plane B — read-only SQL with a runbook |
| "Is everything healthy?" | `/health` is static (`storage: 'not_wired'`) | ✅ Plane B — `GET /v1/admin/ops/health` |
| "Was a backup made? If not, what do I do?" | **No backup exists.** Only D1 Time Travel, inside the same database | ✅ Plane C — backups + status + runbook |
| Restore, reset, deploy to production | CLIs with guards | ❌ Never executed by the assistant — it prints the command |

The assistant is the visible part. The less visible part, and the more urgent
one, is that a wrong `DELETE` on the media bucket is unrecoverable today.

## Goals & Non-Goals

**Goals**
- A local MCP server the operator registers in Claude Code on any machine with
  the repo cloned, targeting one `--label` / `-e` at a time.
- Content authoring through the public API: create and edit **draft** topics,
  upload local media (converting `.mov` when needed), read topics, media and
  comments.
- A server-side guarantee that the assistant cannot publish a topic.
- Recorded job executions (`job_runs`) and a real health probe, so operational
  questions have a factual answer.
- Daily off-database backups of every production D1 and an incremental mirror
  of every production R2 bucket, with a manifest and a weekly restore drill.
- A three-tier command model: diagnose freely, act reversibly only after
  confirmation, never act destructively.
- An explicit data-exposure policy for what the assistant may read.

**Non-Goals**
- A remote MCP server inside the Worker (usable from claude.ai or a phone) —
  deferred; see Alternatives §1.
- Publishing, archiving, deleting or moving topics from the assistant.
- Any write to D1 through SQL.
- Restores executed by the assistant. The restore runbook is for a human.
- Backups of staging (disposable by RFC 0021 §4) and of KV (rate-limit
  counters only).
- Backing up secret *values* — they are write-only in Cloudflare; the operator
  keeps the external ones in a password manager. The assistant only reports
  which ones exist, by name.
- Multi-operator access (tutors, content creators using the assistant).

## Current State (for reference)

- **Scheduled jobs leave no record.** `scheduled()` (`apps/api/src/index.ts:57`)
  runs `runScheduledBilling` and then `sweepPendingSubmissions` on the daily
  `0 6 * * *` cron (`apps/api/wrangler.jsonc:29`). Both only `console.*` their
  outcome (`billing-service.ts:1852`, `:1971`; `sweep-pending-submissions.ts:60`).
  Workers Logs is enabled, but logs are short-lived and not queryable from SQL.
  "Did billing run?" can only be inferred from `invoices`, and an empty day is
  indistinguishable from a failed one.
- **Health is static.** `getHealth` (`controllers/health.controller.ts`)
  returns `status: 'ok'` without touching D1, KV or R2, and the route
  hard-codes `storage: 'not_wired'` (`routes/public/health.ts`).
- **No backup exists.** D1 Time Travel gives point-in-time recovery inside the
  same database, and the deploy and reset CLIs record a bookmark before they
  write (`scripts/cloudflare/deploy.mjs:88`, `renderRestore` at `:277`;
  `scripts/db/reset-remote.mjs`). Nothing exports D1 out of the database,
  nothing copies R2, and no workflow under `.github/workflows/` does either.
  A deleted D1 database or a deleted R2 object is gone.
- **Topics can be published by a content creator.** The admin umbrella admits
  `ADMIN` and `CONTENT_CREATOR` (`routes/admin/index.ts:27`). Events already
  restrict the publish transition to admins through `publishGate`
  (`routes/admin/events.ts:322`), but topics accept `status: 'published'` on
  both create (`routes/admin/topics.ts:124`) and update (`:202`) for either
  role.
- **The API client already exists, in the wrong place.** `import-media.mjs`
  exports `createApiClient` (`:858`), `withRetry` (`:835`), `uploadFile`
  (`:1316`, the `presign → PUT → finalize` lifecycle), `validateMediaFile`
  (`:307`) and `resolveBaseUrl` (`:1427`, with the loopback-only override).
  `scripts/media/convert-skipped.mjs` already remuxes/transcodes `.mov` to an
  API-acceptable `.mp4`.
- **Infra detection already exists.** `provision-label.mjs` detects external
  secrets by name (`externalSecretNames`, `:258`; `secretAction`, `:273`) and
  renders fix commands without ever reading a value.

## Proposed Design

### 1. One principle, three planes

> **The assistant uses only paths that already carry their own guards. It
> never gets a generic shell, a generic `wrangler`, or a write-capable SQL
> connection.**

| Plane | Purpose | Path into the system | Writes? |
|---|---|---|---|
| **A — Authoring** | Topics and media | `aq-mcp` → public API (`/v1/admin/topics/*`) as a `content_creator` | Drafts and media only |
| **B — Operational queries** | Billing, activity, comments, jobs, health | Cloudflare connector D1 query (read-only by rule) + `ops-runbook` skill; `aq-mcp` → `/v1/admin/ops/*` | None |
| **C — Backups & infra** | Backup age, drills, Time Travel window, resource and secret presence | `aq-mcp` → `scripts/backup/status.mjs` and the provision CLI's detection, with a **read-only** Cloudflare token | None (tier 2 below is opt-in and confirmed) |

### 2. Plane A — the authoring MCP server (`aq-mcp`)

**Shape.** A Node stdio MCP server at `scripts/mcp/aq-mcp.mjs`, built on
`@modelcontextprotocol/sdk` (added as a root dev dependency; Zod is already
in the tree). Registered once per machine and target:

```bash
claude mcp add aq-budo-prod -- node /path/to/ArenaQuest/scripts/mcp/aq-mcp.mjs \
  --label budo -e production
```

It runs on the operator's personal computer. That is deliberate: a file
attached to a chat is not a file on disk, and the upload lifecycle needs the
real bytes. Tools take **local paths** (`~/Videos/boas-vindas.mov`).

**Credentials.** `AQ_ADMIN_EMAIL` / `AQ_ADMIN_PASSWORD` from the environment,
never argv and never the chat — the importer's contract. The account is a
dedicated **`content_creator`**, not an admin. `AQ_API_BASE_URL` keeps the
importer's rule: overridable only towards loopback.

**Shared client.** `createApiClient`, `withRetry`, `uploadFile`,
`validateMediaFile` and `resolveBaseUrl` move to `scripts/lib/api-client.mjs`;
`import-media.mjs` re-imports them. One upload lifecycle, two callers.

**Tools (v1):**

| Tool | Does | Guard |
|---|---|---|
| `list_topics(parentId?)` | The tree, with status and media counts | read |
| `read_topic(id)` | Title, markdown, tags, status, media list | read |
| `topic_comments(id, since?)` | Comments for summarising | read |
| `create_topic_draft(parentId, title, markdown, tags?)` | Creates the topic | No `status` parameter: always `draft` |
| `update_topic_draft(id, {title?, markdown?, tags?})` | Edits | Refused unless the stored topic is `draft` |
| `upload_media(topicId, path)` | `validateMediaFile` → convert `.mov` if needed → `presign → PUT → finalize` | Refused unless the topic is `draft`; limits from `limits.ts` |
| `review_link(topicId)` | Backoffice URL for the operator to review and publish | read |

The MCP schemas carry `readOnlyHint` / `destructiveHint: false` annotations so
the client can auto-approve reads and prompt on writes.

**"Never publishes" at three layers.** (1) The tool surface has no way to
express a status. (2) The account is a `content_creator`. (3) **The API
refuses a content creator's publish**: `routes/admin/topics.ts` gains the
same conditional gate as events — `status: 'published'` on `POST /` or
`PATCH /{id}` requires `ADMIN`; everything else, `archived` included, stays
open to both roles. Layer 3 is what makes the guarantee a permission rather
than a behaviour.

**Conversion.** `.mov` reuses `convert-skipped.mjs`'s remux/transcode
ladder (extracted to `scripts/lib/convert.mjs`). A missing `ffmpeg` is
reported with its install command, never installed.

### 3. Plane B — operational queries

**3.1 `job_runs`.** A new migration (next free number at implementation
time):

```sql
CREATE TABLE IF NOT EXISTS job_runs (
  id          TEXT PRIMARY KEY,
  job         TEXT NOT NULL CHECK (job IN ('billing', 'sweep_submissions')),
  trigger     TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  summary     TEXT,            -- JSON counts: invoices created, rows swept, …
  error       TEXT             -- message only, truncated to 1 KiB, no payloads
);
CREATE INDEX IF NOT EXISTS idx_job_runs_job_started ON job_runs (job, started_at DESC);
```

`scheduled()` inserts `running` before each job and updates it after, inside
the existing `try/finally`, so a failed billing still records `failed` and
the sweep still runs. `POST /v1/admin/billing/invoices/run` records
`trigger = 'manual'`. A failure to write `job_runs` is logged and never
fails the job it describes. Rows older than 180 days are pruned by the same
daily run.

**3.2 A real health probe.** `GET /v1/admin/ops/health` (admin and content
creator): a `SELECT 1` on D1, a KV `get` of a fixed key, an R2 `head` of a
fixed key, the latest applied migration, and the last `job_runs` row per job
with its age. Each check reports `ok | degraded | down` and its latency. The
public `/health` stays as it is: it is anonymous and must not leak internals.
`GET /v1/admin/ops/job-runs?job=&since=` lists runs.

**3.3 SQL through the Cloudflare connector.** For open questions ("which
students did nothing this month?") the assistant uses the Cloudflare
connector's D1 query tool. That connector runs any statement with the
operator's account, so read-only is a **rule**, not a permission — written
down in the `ops-runbook` skill and backed by D1 Time Travel as the safety
net. Hardening it into a permission is Open Question 5.

**3.4 The `ops-runbook` skill.** `.claude/skills/ops-runbook/SKILL.md` gives
the assistant what it would otherwise rediscover every session: the D1 name
per label and environment, a commented schema map, canned queries (billing
of the day, overdue invoices, activity by student, comments by topic,
submissions waiting), the computed predicates that are not columns ("past"
events, effective topic access), and the rules: `SELECT` only; production
only when asked; the data policy of §6.

### 4. Plane C — backups and infrastructure status

**4.1 D1 export.** `.github/workflows/backup.yml`, daily (offset from the
billing cron), `strategy.matrix.label` like the deploy workflow, production
only. `scripts/backup/export-d1.mjs` resolves the profile, runs
`wrangler d1 export <db> --remote`, gzips the dump, computes its SHA-256 and
per-table row counts, and writes:

```
<label>-backups/d1/production/2026/10/02/<iso-ts>.sql.gz
<label>-backups/d1/production/manifest.json   # latest + history (ts, bytes, sha256, rowCounts, drill)
```

Retention through R2 lifecycle rules on the backup bucket: dailies for 35
days, the first dump of each month copied under `monthly/` for 12 months.
The backup bucket is a new resource in the label profile (`backup` block)
and is created by `provision-label.mjs`.

**4.2 R2 mirror.** `scripts/backup/mirror-r2.mjs` lists the media bucket and
copies to `<label>-backups/r2/…` every object whose key or ETag is not yet
there. It **never deletes** on the mirror side in v1: an object removed from
the source is kept, tagged with its removal date, and pruned after 90 days.
That window is the whole point — it is what makes an accidental delete
recoverable.

**4.3 Off-account copy.** A backup in the same Cloudflare account does not
survive the loss of that account. The design reserves a second destination
(any S3-compatible provider, or the operator's disk through
`make backup-pull-prod LABEL=x`); which one is Open Question 4. Phases 0–1
ship without it; the status report flags it as missing.

**4.4 Restore drill.** Weekly, the same workflow downloads the latest dump,
applies it to a throwaway local D1 (the mechanism of the *Demo seed check*
job), and compares row counts with the manifest. The outcome is written back
into the manifest as `drill: { at, ok, mismatches }`. A backup that has never
been restored is not counted as a backup by the status report.

**4.5 Status.** `scripts/backup/status.mjs --label x -e production` reads the
manifest and `wrangler d1 time-travel info`, and returns: age of the last D1
dump, size delta vs. the previous one, last drill result, R2 mirror lag
(objects and bytes not yet mirrored), Time Travel window, off-account copy
present or not. Every non-green finding comes with **the command that fixes
it** — the provisioner's "detect and report the command" pattern.

**4.6 Restore.** `docs/operations/backup-restore.md` documents both paths —
Time Travel (`renderRestore`'s command) for "minutes ago", the dump for
"database lost" — and the R2 copy-back. Restore is tier 3 (§5): the assistant
can open the runbook and fill in the exact command, never run it.

### 5. The three command tiers

| Tier | What | Who executes | Examples (`aq-mcp` tools) |
|---|---|---|---|
| **1 — Diagnose** | Read-only facts | The assistant, freely | `system_health`, `job_runs`, `backup_status`, `time_travel_status`, `infra_status` |
| **2 — Reversible action** | Creates something, destroys nothing | The assistant, **after the operator confirms a printed plan** | `backup_now` (runs `export-d1.mjs` locally), `bookmark_now` |
| **3 — Destructive** | Restore, reset, deploy, delete | **The operator only** | `restore_instructions` returns the command and the runbook section |

`infra_status` reuses the provisioner's detection through a new read-only
`--check` mode of `provision-label.mjs` (resource presence + secret names),
so there is still one source of truth for "what a label needs".

Tier 2 is a two-call protocol: the first call returns the plan and a
single-use confirmation id; the second call, carrying that id, executes. The
id expires after 5 minutes.

**Credentials per tier.**
- `AQ_CF_READ_TOKEN` — a Cloudflare API token with **read-only** scopes (D1
  read, R2 read on the backup bucket, Workers read). The only Cloudflare
  credential `aq-mcp` loads. Tier 1 runs on it.
- The operator's `wrangler login` — used by tier 2 only, after confirmation,
  in the operator's own process.
- `CF_API_TOKEN` in CI — the backup workflow's write token; never on a
  workstation.

Tier 3 is therefore enforced by credentials, not by trust: the process the
assistant drives never holds a token that can restore, reset or deploy.

### 6. Data exposure policy

Everything a tool returns is sent to the model provider. The policy, enforced
by the tool layer (Plane A/C) and stated in the runbook (Plane B):

| Data | Exposed? |
|---|---|
| Topics, media metadata, tags, published comments | Yes |
| Billing aggregates, invoice status, job runs, health | Yes |
| Student names and activity | Yes, on request; summaries refer to students by name only when asked |
| E-mail, phone/WhatsApp | Only when the operator asks for a specific person |
| Private student notes (`topic_notes`, `visibility = 'private'`) | **No** (Open Question 6) |
| Submission files | **No**; metadata only |
| Password hashes, refresh tokens, secret values | **Never** |

### 7. Audit trail

`aq-mcp` appends one JSONL line per tool call to
`.arenaquest/mcp-audit-<label>-<env>.jsonl` (gitignored, like the importer's
ledger): timestamp, tool, arguments minus content bodies, outcome. API writes
are additionally attributable server-side to the dedicated content-creator
account.

## Alternatives Considered

1. **Remote MCP server inside the Worker (`/mcp`, Streamable HTTP).** The
   cleanest fit for Ports & Adapters, and the only way to reach the system
   from claude.ai or a phone. **Deferred, not rejected.** Claude.ai remote
   connectors expect OAuth 2.1, and the convention "no external auth deps"
   rules out the off-the-shelf provider library; doing OAuth with Web Crypto
   is a project of its own. The authoring use case also needs local files,
   which a remote server does not have. The tool functions of §2 are written
   so they can later be mounted remotely without changes.
2. **Writes through SQL (the Cloudflare D1 connector).** Rejected. It would
   skip `sanitizeMarkdown`, sibling `sort_order`, tag slugging, media limits
   and the R2 upload entirely.
3. **A generic "run wrangler" tool.** Rejected. It would hand the assistant
   every destructive command the deploy and reset CLIs carefully guard.
4. **The Cloudflare connector alone (no `aq-mcp`).** Accepted for Plane B's
   open questions, insufficient for the rest: no API semantics, no local
   uploads, and no backup to report on.
5. **A CLI + skill, without MCP.** Claude Code can run scripts directly, so
   this would work. MCP was preferred because typed tools with annotations
   make the read/write boundary visible to the client and approvable per
   tool. The tools are plain functions in `scripts/lib/`, so a CLI wrapper
   remains a few lines away.
6. **D1 Time Travel as the backup.** Rejected as sufficient: it lives in the
   same database and the same account, and does not cover R2 at all. It
   remains the first resort for "undo the last few minutes".
7. **A third-party backup service.** Deferred. The export and mirror are small
   scripts; a service adds a vendor holding the full student database.

## Implementation Plan

Total **~11 dev days**. Phase 0 is first because it closes a real data-loss
risk whether or not the assistant ever ships.

### Phase 0 — Backups (~3 days)
Backup bucket in the label profile and in `provision-label.mjs`;
`export-d1.mjs` + manifest; `mirror-r2.mjs`; `backup.yml` (daily export and
mirror, weekly drill); `drill.mjs`; `docs/operations/backup-restore.md`.

### Phase 1 — Observability (~1.5 days)
`job_runs` migration and recording in `scheduled()` and the manual billing
route; `GET /v1/admin/ops/health` and `/job-runs`; pruning.

### Phase 2 — Topic publish gate (~0.5 day)
Admin-only `status: 'published'` on topic create and update, mirroring
`publishGate`; tests for both roles and both routes.

### Phase 3 — Authoring MCP (~3 days)
Extract `scripts/lib/api-client.mjs` and `scripts/lib/convert.mjs`;
`aq-mcp` with the Plane A tools, annotations and audit log; install section
in `docs/onboarding.md`.

### Phase 4 — Ops tools and runbook (~2 days)
`status.mjs`; `provision-label.mjs --check`; Plane B/C tools in `aq-mcp`
(tiers 1–3); the `ops-runbook` skill; the read-only Cloudflare token
procedure.

### Phase 5 — Daily brief (optional, ~1 day)
An MCP prompt `daily_brief` (health, job runs, backup status, overdue
invoices, new submissions and comments), and a documented Claude Code Routine
that runs it each morning and notifies only on an anomaly.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| The D1 connector can write; "read-only" is a rule | Runbook rule + Time Travel bookmark as a safety net; Open Question 5 hardens it into a permission |
| Content reaches the model provider | §6 policy enforced in the tool layer; private notes and files excluded; no secrets ever |
| A prompt-injected comment or topic text steers the assistant | Writes limited to drafts; no publish, no destructive tool, no write-capable Cloudflare token in the process; every write audited |
| `wrangler d1 export` may hold the database while it runs | Run off-peak, offset from billing; measure duration in Phase 0 and record it in the manifest |
| Backups in the same account | §4.3 off-account copy; flagged as missing until it exists |
| Backup bucket grows unbounded | Lifecycle rules; mirror prunes source-deleted objects after 90 days |
| Restricting topic publish breaks a real content creator's workflow | Open Question 2, checked per label before Phase 2 ships |
| A second operator machine drifts (old checkout) | `aq-mcp` prints its commit and how far it is behind `origin/main` at start-up; tools rely only on the public API contract, so an old checkout degrades to missing tools, not wrong writes |

## Success Criteria

- Phase 0: every production label has a dump less than 26 h old and a passing
  drill less than 8 days old in its manifest; deleting a media object on a
  staging copy and restoring it from the mirror works by following the
  runbook alone.
- Phase 1: "did billing run today?" has a factual answer for every day,
  including days with nothing to bill; a forced billing failure produces a
  `failed` row and the sweep still runs.
- Phase 2: a `content_creator` gets `403` publishing a topic through either
  route; an admin does not; drafts and `archived` are unaffected.
- Phase 3: from a clean personal machine, the operator writes the Welcome
  topic with a local `.mov` and photos through the assistant, and it lands as
  a draft with ready media, visible in the backoffice; no tool call can
  produce a published topic.
- Phase 4: `backup_status` answers "was a backup made?" with an age, a drill
  result and, when not green, the fix command; no `aq-mcp` code path holds a
  token able to restore, reset or deploy.

## Open Questions

1. **Installation on the personal machine** — clone the repo (simplest; same
   scripts) or a packaged `npx` entry point? *Owner: raphaelsilva.*
2. **Topic publish becomes admin-only** — does any real content creator on
   Budo, Spaziord or ArenaQuest publish topics today? *Owner: raphaelsilva.*
3. **Editing published topics** — v1 refuses. Should a later version create
   a draft revision of a published topic instead? That needs a revision model
   the API does not have. *Owner: raphaelsilva.*
4. **Off-account backup destination** — another S3-compatible provider, or
   the operator's disk on a schedule? *Owner: raphaelsilva.*
5. **Read-only SQL as a permission** — can a Cloudflare API token scoped to
   D1 read execute `SELECT` through the query endpoint? If yes, Plane B moves
   to an `aq-mcp` `query` tool on `AQ_CF_READ_TOKEN` that also rejects
   non-`SELECT` statements. *Owner: implementer, Phase 4.*
6. **Private notes** — excluded by default. Is there a case for the operator
   reading them through the assistant (admins can in the backoffice)?
   *Owner: raphaelsilva.*
7. **Claude Desktop** — `aq-mcp` is a stdio server, so it also runs in the
   desktop app. Support it officially, or Claude Code only? *Owner:
   raphaelsilva.*

## References

- Scheduled jobs: `apps/api/src/index.ts:57`, `apps/api/wrangler.jsonc:29`,
  `apps/api/src/core/billing/billing-service.ts:1959`,
  `apps/api/src/jobs/sweep-pending-submissions.ts`
- Health: `apps/api/src/routes/public/health.ts`,
  `apps/api/src/controllers/health.controller.ts`
- Publish gate precedent: `apps/api/src/routes/admin/events.ts:322`;
  role umbrella: `apps/api/src/routes/admin/index.ts:27`
- API client and upload lifecycle: `scripts/content/import-media.mjs:307,835,858,1316,1427`
- Conversion: `scripts/media/convert-skipped.mjs`
- Time Travel bookmarks: `scripts/cloudflare/deploy.mjs:88,277`,
  `scripts/db/reset-remote.mjs`
- Secret detection: `scripts/cloudflare/provision-label.mjs:258,273`
- Related RFCs: RFC 0011 (label deploy CLI — the one release path),
  RFC 0012 (tenant provisioning and the secret contract),
  RFC 0013 (billing — the job being observed), RFC 0016 (student notes
  privacy), RFC 0018 (storage browser and orphan audit), RFC 0020 (student
  submissions), RFC 0021 (disposable staging, Time Travel bookmarks)
