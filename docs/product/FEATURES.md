# ArenaQuest — Feature Catalog

What the platform actually does, grouped by product area. Each entry is one
feature: a short description, where it lives in the code, and a link to the
milestone that built it and the RFC that specified it.

This is the **reading** surface. The milestone folders under
[`milestones/`](./milestones/) are the **specification** surface — open one only
when you need the requirements, acceptance criteria, or task breakdown behind an
entry here.

**Status** is stated against the code in `main`, not against the milestone
document. Where the two disagree, the entry says so.

| | Meaning |
|---|---|
| ✅ | Shipped and present in `main` |
| 🚧 | Partially shipped — see the note on the entry |
| 📝 | Specified only; no implementation yet |

---

## 1. Platform Foundation

### Monorepo, Ports & Adapters, edge deployment
pnpm workspaces + Turborepo across `apps/web`, `apps/api` and `packages/shared`.
Business logic depends only on the TypeScript interfaces in
`packages/shared/ports/`, so swapping JWT → Auth0, D1 → Postgres or R2 → S3 is a
new adapter rather than a rewrite. Both apps deploy to the Cloudflare edge
(Workers for the API, Pages for the web) through GitHub Actions.

**Code:** `packages/shared/ports/`, `apps/api/src/adapters/`, `turbo.json`
→ [M1 Foundation & Infrastructure](./milestones/1-foundation-and-infrastructure/milestone.md) · ✅

### Canonical entity schema
One namespaced type tree (`Entities.Config`, `.Identity`, `.Content`,
`.Engagement`, `.Progress`, `.Gamification`) that both apps import, so the API
and the web app can never drift on what a `TopicNode` or an `Enrollment` is.

**Code:** `packages/shared/types/entities.ts`
→ [M1](./milestones/1-foundation-and-infrastructure/milestone.md) · ✅

---

## 2. Identity & Access

### Authentication and RBAC
JWT access tokens (HS256) plus refresh tokens, built on the Web Crypto API only —
no `jsonwebtoken`, no `bcrypt`. PBKDF2 at 100,000 iterations (the Cloudflare
ceiling). Roles gate the admin backoffice on both the API guard and the web
middleware.

**Code:** `apps/api/src/adapters/auth/`, `apps/api/src/controllers/auth.controller.ts`
→ [M2 Authentication & User Management](./milestones/2-authentication-and-user-management/milestone.md) · ✅

### Admin user lifecycle
Full user CRUD from the backoffice, with lockout guards that refuse to delete the
last active admin or let an admin lock themselves out.

**Code:** `apps/api/src/controllers/admin-users.controller.ts`
→ [M2](./milestones/2-authentication-and-user-management/milestone.md) · ✅

### Auth hardening
The security-audit backlog from M2 closed as one bounded epic: refresh tokens
hashed at rest, sessions revoked on admin mutation, constant-time login, login
rate limiting and lockout, PBKDF2 upgrade-on-login, production seed guard, and
adversarial tests against the JWT adapter.

**Code:** `apps/api/src/adapters/auth/`, `apps/api/src/adapters/db/d1-refresh-token-repository.ts`
→ [M2-extends Auth hardening](./milestones/2-extends-auth-hardening/auth-hardening.story.md) · ✅

### Password self-service and Google OAuth
A user recovers access without an admin: time-limited reset link by email,
plus change-password from settings. Google OAuth signs in or auto-provisions a
`student`, and links to an existing email account. Provider independence is
preserved through the adapter pattern.

**Code:** `apps/api/src/controllers/{password,google-oauth}.controller.ts`, `apps/web/src/app/(auth)/`
→ [M6 Auth Self-Service & Social Login](./milestones/6-auth-self-service-and-social-login/milestone.md) · ✅

### Public self-registration with email activation
`POST /auth/register` creates an `INACTIVE` user behind a rate limit (5 requests
/ 15 min) and a minimum password policy, then sends an activation email.

**Code:** `apps/api/src/controllers/{register,activate}.controller.ts`
→ [M3-extends / login](./milestones/3-extends-cors-registration-refactoring/login/ReleaseNotes.md) · ✅

### Enrollment enforcement and node visibility
Every topic node carries a `visibility` of `PUBLIC` / `RESTRICTED` / `PRIVATE`.
Access resolves in a single recursive CTE — `(allow_tree ∪ public_set) −
private_set` — under 50 ms on the 1,000-topic fixture. Admins and content
creators bypass the resolver entirely. Comments inherit the same effective-access
set rather than defining their own. Ships with a topic-editor visibility selector
and one principal-centric Access page that replaced the old per-user/per-group
enrollment tabs.

**Code:** `apps/api/src/adapters/db/d1-enrollment-repository.ts`, `apps/web/src/app/(protected)/admin/access/`
→ [M12 Enrollment & visibility](./milestones/12-enrollment-visibility/milestone.md) · [RFC 0005](./RFCs/0005-enrollment-exclusions-and-visibility.md) · ✅

---

## 3. Content & Catalog

### Hierarchical topic tree and media
A persistent tree of `TopicNode`s with Markdown body text, and PDFs / videos /
images attached to any node. Media moves through a presigned-upload lifecycle
against R2 over the S3-compatible API; a media repository tracks records and
their topic associations. Markdown is sanitised before it is persisted, never at
render time.

**Code:** `apps/api/src/adapters/{db/d1-topic-node-repository.ts,storage/}`, `packages/shared/utils/sanitize-markdown.ts`
→ [M3 Content & Media Core](./milestones/3-content-and-media-core/milestone.md) · ✅

### Admin authoring surfaces
The topic-tree manager and the media uploader — where content creators actually
put material into the platform.

**Code:** `apps/web/src/app/(protected)/admin/topics/`
→ [M3](./milestones/3-content-and-media-core/milestone.md) · ✅

### Participant catalog
The learner-facing catalog, rebuilt to the wireframe: route topology collapsed to
`/catalog` and `/catalog/[id]` so any node at any depth is addressable by id, a
stats trio in the topic header, a two-column subtopic grid with meta pills, and
inline-expandable media stages for video / audio / PDF. Subtopic cards render
their media mix from an additive `mediaCount` projection, so no second fetch.
Includes a per-topic discussion list.

**Code:** `apps/web/src/app/(protected)/catalog/`, `apps/web/src/components/catalog/`
→ [M11 Catalog redesign](./milestones/11-catalog-redesign/milestone.md) · [RFC 0004](./RFCs/0004-catalog-redesign.md) · ✅

---

## 4. Tasks, Engagement & Progress

### Task engine with staged interconnection
A `Task` is an authored record made of ordered `TaskStage`s, each with its own
semantics (Reading, Practice, Peer Review…). Tasks link N-to-N to topics, and so
does each individual stage. Referential integrity holds: a published task cannot
link to unpublished or archived topics.

**Code:** `apps/api/src/controllers/admin-{tasks,task-stages,task-linking}.controller.ts`
→ [M4 Task Engine & Interconnection](./milestones/4-task-engine-and-interconnection/milestone.md) · ✅

### Progress tracking and the learner dashboard
A learner checks into task stages one at a time — append-only, no skipping,
idempotent under double-submit — and marks topics as consumed. Completion
percentages are computed deterministically from the raw progress rows, with no
denormalised counters. `/dashboard` surfaces pending work and progress rollups.

**Code:** `apps/api/src/controllers/me-dashboard.controller.ts`, `apps/web/src/app/(protected)/dashboard/`
→ [M5 Engagement & Student Progress](./milestones/5-engagement-and-student-progress/milestone.md) · ✅

### Enrollment grants
Admins grant a user or a user group access to a topic subtree; a learner only
sees tasks whose required topics are all granted. Effective access resolves
through a recursive CTE with request-level caching.

**Code:** `apps/api/src/adapters/db/d1-enrollment-repository.ts`
→ [M5](./milestones/5-engagement-and-student-progress/milestone.md) · ✅ _(superseded in part by M12 visibility)_

---

## 5. Gamification

### XP, levels and streaks
XP is awarded for participant actions (video watch, subtopic completion, stage
check-in, comment, daily login) and accumulates into named level ranks.
Consecutive-day streaks are tracked, and a per-tenant leaderboard ranks players.
The engines are pure domain code in `packages/shared`, so they are testable
without the Workers runtime.

**Code:** `packages/shared/domain/gamification/{xp-engine,streak-engine,level-table}.ts`, `apps/api/src/controllers/leaderboard.controller.ts`
→ [M7 Gamification Engine & Learner UX](./milestones/7-gamification-engine-and-learner-ux/milestone.md) · ✅

### Quests, missions and badges
Daily quests (24 h reset), weekly challenges (Monday 00:00 reset) and
time-bound special missions authored by instructors, each granting XP and
optional badge rewards. Badges unlock by rule ("complete topic X", "hit a 7-day
streak").

**Code:** `apps/api/src/controllers/{me-quests,me-missions,admin-badges}.controller.ts`
→ [M7](./milestones/7-gamification-engine-and-learner-ux/milestone.md) · ✅

### Topic discussion
A comment thread attached to each topic node, one reply level deep, with an
instructor badge on the author chip. Access is inherited from topic visibility.

**Code:** `apps/api/src/controllers/comments.controller.ts`
→ [M7](./milestones/7-gamification-engine-and-learner-ux/milestone.md) · ✅

### Gamification catalog administration
Backoffice CRUD over the *definitions*: `/admin/badges`, `/admin/quests`,
`/admin/missions` and `/admin/levels`, behind one typed web client and a
Gamification card group on the `/admin` hub.

**Code:** `apps/api/src/controllers/admin-{quests,levels,badges,missions}.controller.ts`, `apps/web/src/lib/admin-gamification-api.ts`
→ [M15 Gamification catalog administration](./milestones/15-gamification-catalog-administration/milestone.md) · [RFC 0009](./RFCs/0009-gamification-catalog-administration.md) · ✅

### Player progression administration
The per-user counterpart to the catalog: read one player's progression, award or
revoke a badge, adjust XP through the `xp_events` ledger (never by writing the
total), and recompute a single user.

**Code:** `apps/api/src/controllers/admin-progression.controller.ts`, `apps/web/src/app/(protected)/admin/players/`
→ [M16 Player progression administration](./milestones/16-player-progression-administration/milestone.md) · [RFC 0010](./RFCs/0010-player-progression-administration.md) · ✅

---

## 6. API Platform

### Route topology and OpenAPI contract
20 sibling route mounts collapsed into 5 cohesive sub-apps (`public`, `auth`,
`me`, `admin`, `docs`), each prefix with a single owner. OpenAPI 3.1 via
`@hono/zod-openapi` is the source of truth, served at `/openapi.json` and
rendered at `/docs`. The 30-field `deps` bag became an `AppContainer` grouped by
bounded context. Business routes carry a `/v1` prefix; the frontend's request
types are generated from the committed contract.

**Code:** `apps/api/src/{container.ts,openapi/}`, `apps/api/openapi.json`, `apps/web/src/lib/api-types.gen.ts`
→ [M9 Route reorganization & OpenAPI](./milestones/9-api-routes-openapi/milestone.md) · [RFC 0003](./RFCs/0003-apps-api-route-organization-and-openapi.md) · ✅

### Controller pattern
Routes handle only HTTP concerns; all business logic sits in controllers that
return a `ControllerResult<T>`. `@ValidateBody(schema)` + `@Body()` decorators
centralise Zod validation and short-circuit with a `400` on failure.

**Code:** `apps/api/src/core/{result.ts,decorators.ts}`, `apps/api/src/controllers/`
→ [M3-extends / refactoring](./milestones/3-extends-cors-registration-refactoring/refactoring/01-move-route-logic-to-controllers.task.md) · ✅

### Dynamic CORS origin policy
`ALLOWED_ORIGINS` accepts three forms resolved by one `OriginPolicy` module:
exact origins (O(1) hash-set lookup), single-label wildcard subdomains for PR
preview deployments, and a full wildcard that echoes the request origin — because
browsers reject a literal `*` on credentialed requests. Production is locked to
exact origins.

**Code:** `apps/api/src/core/cors/`
→ [M3-extends / cors](./milestones/3-extends-cors-registration-refactoring/cors/ReleaseNotes.md) · ✅

### Test suite optimization
Vitest split into two projects — `workers` (Miniflare pool) and `node` (plain
unit tests) — so pure-unit tests stop paying the Miniflare tax. ~29 inline
`CREATE TABLE` blocks were replaced by a shared `apply-migrations` helper reading
the canonical migrations folder, ending schema drift in tests. The router-spec vs
controller-spec convention is written down.

**Code:** `apps/api/vitest.config.mts`, `apps/api/test/README.md`
→ [M8 API test optimization](./milestones/8-api-test-optimization/milestone.md) · [RFC 0001](./RFCs/0001-apps-api-test-suite-optimization.md) · ✅

---

## 7. Internationalization

### Build-time dictionary system
Every user-facing string in `apps/web` lives in a typed dictionary (`dict-en`,
`dict-pt`) that both satisfy one shared `Dictionary` type — so a missing
translation is a typecheck failure, not a runtime blank. The language is chosen
at build time via `NEXT_PUBLIC_LANGUAGE`; each build carries exactly one
dictionary and tree-shakes the other. Server Components import `dict`; Client
Components use `useDict()`. A CI coverage scan blocks hardcoded copy under
`src/{app,components,hooks}/**`.

There is deliberately **no runtime language switcher** — switching the deployed
language means setting the env var and redeploying.

**Code:** `apps/web/src/i18n/`, `apps/web/src/context/dict-context.tsx`
→ [M10 Frontend i18n](./milestones/10-frontend-i18n/milestone.md) · [RFC 0002](./RFCs/0002-frontend-internationalization-i18n.md) · ✅

---

## 8. White-label & Delivery

### Brand configuration
One typed `brand` object read by every brand surface — logo, footer copyright,
document metadata, the OAuth callback screen — so rebranding never means hunting
for the place someone forgot. The mark renders as `<Sigla> <LabelName>` from
build-time env, defaulting to `AQ` / `ArenaQuest`, and the favicon is generated
statically at build time from that same sigla badge. A "Powered by ArenaQuest"
attribution survives rebranding.

**Code:** `apps/web/src/lib/brand.ts`, `apps/web/src/app/icon.tsx`
→ [M13 White-label branding](./milestones/13-white-label-branding/milestone.md) · [RFC 0006](./RFCs/0006-white-label-branding-and-build-tooling.md) · ✅

### Configuration validation
A read-only validator over a tenant's configuration: presence checks across
Worker vars, secrets and Pages env; coherence checks that resolve the symbolic
`apiHost` / `webOrigin` anchors; and a policy check that rejects the CORS full
wildcard outside local. Exposed as `make label-check LABEL=x ENV=staging` and
reused as the fail-closed preflight step inside the deploy CLI.

**Code:** `scripts/label.mjs` (`checkPresence` / `checkCoherence` / `checkPolicy` / `mapExitCode`), `config/deployment.schema.jsonc`
→ [M14 Deployment preflight & config validation](./milestones/14-deployment-preflight-configuration-validation/milestone.md) · [RFC 0007](./RFCs/0007-deployment-preflight-and-config-validation.md) · 🚧
_Shipped in a different shape than the milestone specifies: the checks live in
`scripts/label.mjs` against `config/deployment.schema.jsonc`, not in a standalone
`scripts/preflight.mjs` against a `config/deployment.manifest.jsonc`. Reconciling
the milestone doc to the shipped shape is open work._

### Branded deploy CLI
One entrypoint releases any tenant to any environment:
`node scripts/cloudflare/deploy.mjs --label <label> -e <staging|production>`.
The core is cloud-agnostic — it resolves *what* to deploy and emits a
provider-neutral plan, importing no wrangler and no cloud SDK — while the
Cloudflare entrypoint executes *how*. Preflight is fail-closed: a hard config gap
aborts before D1 or the Worker are touched. Production always confirms by typing
the label. Makefile targets and the CI matrix are thin wrappers over the same CLI,
so a maintainer's local release uses the exact code path CI uses.

**Code:** `scripts/deploy/core.mjs`, `scripts/cloudflare/deploy.mjs`
→ [M17 Branded deploy CLI](./milestones/17-branded-deploy-cli/milestone.md) · [RFC 0011](./RFCs/0011-branded-deploy-cli-label-parametrized-ci-independent-release.md) · ✅

### Tenant provisioning
`make set-new-label LABEL=x` brings up both planes for a new tenant: D1, KV, R2
and the Pages project, plus a real Worker — spawned through the deploy CLI, so
there is still exactly one release code path. `JWT_SECRET` is generated per label
*and* per environment (a shared key would let a token minted for one tenant verify
on another), handed to wrangler over stdin, and never overwritten. R2 CORS is
derived from the profile's `ALLOWED_ORIGINS` rather than committed, so it cannot
drift. Externally-valued secrets are detected by name and reported with their fix
command — never written. Re-running is a no-op, and `--dry-run` needs no
credential and changes nothing.

**Code:** `scripts/cloudflare/provision-label.mjs`, `config/labels/<label>.jsonc`
→ [M18 Tenant provisioning](./milestones/18-tenant-provisioning-backend-parity/milestone.md) · [RFC 0012](./RFCs/0012-tenant-provisioning-backend-parity.md) · ✅

---

## Specified but not built

| Feature | Where |
|---|---|
| User dashboard with topic recommendations and badge achievements | [RFC 0008](./RFCs/0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md) — no milestone yet |
| Negative enrollment grants ("denies") | Deferred section of [RFC 0005](./RFCs/0005-enrollment-exclusions-and-visibility.md) |
| Comment likes and threaded replies | Deferred from [M11](./milestones/11-catalog-redesign/milestone.md) |
| Runtime language switching, per-user language preference, content localization | RFC 0002 Phase 4 |
| E2E coverage (Playwright) | [backlog/test-debt/](./backlog/test-debt/) |

---

## How these documents relate

```
RFC                      → the proposal: why, alternatives, tradeoffs
  docs/product/RFCs/NN-<slug>.md

milestone                → the contract: objectives, requirements,
  milestones/<N>-<slug>/    acceptance criteria, task table
    milestone.md

task                     → the unit of execution
    NN-<slug>.task.md
```

Not every milestone has an RFC — M1 through M7 predate the RFC process and were
driven directly from [`specification.md`](./specification.md).

Implementation exhaust — per-task execution plans (`planing/`), executor logs and
per-milestone closeout notes — is **not kept in the tree**. It was working
material for a single run, it is `.gitignore`d, and the historical copies remain
in git history if you ever need them.
