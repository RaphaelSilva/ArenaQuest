# Release Notes

## Unreleased

## Milestone 27 — Mission requirements

> Missions became step-by-step goals built from real evidence — demonstrations, visits, videos, self-checks and event participation — with enrollment, per-step rewards and a daily safety net.

### New Features

- **🎬 Video XP is back**
  - Watching a lesson video to the end now earns XP and counts toward weekly video challenges and video badges.
  - The catalog reports a video once it has played 90 % or reached its end, once per video per page view; a failed report never interrupts playback.

- **🧭 Missions with steps**
  - A mission is an ordered list of 1 to 20 steps of five kinds: demonstrations on a topic, a topic visit, lesson videos watched, a self-check, and participation in a priced event.
  - Steps run in any order or in sequence; evidence counts only inside the mission's window, and a sequential step only after the previous one closed.
  - Each step can grant XP; the mission grants XP and optionally a badge. Rewards are granted once and are never taken back, and closing a step keeps the daily streak alive.

- **🙋 Joining and following missions**
  - Three enrollment modes: automatic (every student who can open the mission's topics), open (*Join* / *Leave* from the dashboard) and assigned to users and groups (everyone else sees a locked teaser).
  - The dashboard groups missions into *My missions* (per-step progress and links to each target), *Available* and *Locked*.
  - A new mission page lists every step, with *I did it* for self-check steps (confirmed, final) and *Leave* for missions the student joined.

- **🛠️ Mission editor for admins**
  - A structured editor: step kind, topic and event pickers, per-kind settings, drag or up/down ordering, audience, and a badge suggestion for windows of 14 days or more.
  - Rules freeze once a mission starts; its title, description, active flag and step titles stay editable, and its end date can still be extended.
  - Writes are admin-only; content creators keep read access to the list, the editor and the participants.
  - A *Participants* tab shows each student's step chips, pages through large rosters and offers *Reconcile now* to admins.

### Platform Enhancements & Fixes

- Steps close in the same request that produced the evidence; a daily reconciliation closes whatever a request missed and never reopens anything.
- The demo seed ships a *Get started* mission expressed as steps (visit a lesson, share one demonstration).
- Missions created before this release keep progressing as before until they end; new missions are always built from steps.

---

## Milestone 5 — Engagement & Student Progress

> The learner loop closed: student-facing dashboards, stage check-ins, and granular enrollment control.

### New Features

- **📊 Student Dashboard**
  - Live interaction hub with real-time progress summary (topics & tasks).
  - "Continue Learning" section powered by SWR (Stale-While-Revalidate) for instant loading.
  - Interactive SVG-based progress rings and root-topic rollup visualizations.
  - Accessible design with numerical text equivalents for all visual indicators.

- **✅ Engagement & Progress Tracking**
  - **Stage Check-ins:** Sequential, auditable, and idempotent check-in system for task stages.
  - **Progress Signals:** Implicit "visit" tracking and explicit "mark as read" actions for topics.
  - **Deterministic Aggregation:** Completion percentages computed on-the-fly to ensure accuracy.

- **🛡️ Granular Access Control (Enrollment)**
  - Direct user-to-topic grants and group-based access inheritance.
  - Recursive Effective Access: High-performance CTE calculation for full subtree visibility.
  - Admin Enrollment UI: Manage access for individuals or cohorts with cascading revoke support.

- **⚡ Platform Performance**
  - Recursive CTE optimization for access lookups (sub-50ms latency).
  - Intelligent request-level caching for effective access sets.
  - Optimized database schema for progress and enrollment tracking.

---

## Milestone 4 — Task Engine & Interconnection

> Integrated pedagogical task system with nested stages and curriculum-topic linking.

### New Features

- **🏗️ Pedagogical Task Engine**
  - New Task entity with draft/published/archived states.
  - Hierarchical Task Stages (Reading, Practice, Review) with interactive reordering.
  - Interconnection: Tasks and individual stages can be linked to multiple curriculum topics.

- **🛠️ Admin Task Management**
  - New Admin Tasks Dashboard for lifecycle management.
  - Interactive Stage Editor with drag-and-drop support (via `@dnd-kit`).
  - Validation guards prevent publishing tasks with invalid stage/topic configurations.

- **🎓 Student Task Experience**
  - Read-only Task Catalog for browsing published learning paths.
  - Task Detail view with full Markdown support and deep-links to the curriculum catalog.
  - Semantic HTML structure ensuring screen-reader accessibility for task stages.

- **🛡️ Quality & Security**
  - Strict ownership checks prevent cross-topic stage or media injection.
  - Comprehensive unit and integration test suite covering the full task-topic graph.
  - Zero-overhead storage adapter ensures cloud-agnostic R2 usage.

### Platform Enhancements & Fixes

- **🌐 Dynamic CORS Engine**
  - New type-safe `OriginPolicy` module with wildcard subdomain matching support (`*.pages.dev`).
  - Improved environment-specific CORS rules ensuring strict security for production and flexibility for staging/local development.
- **✨ UX Improvements**
  - Stylized login page with updated design tokens, fluid animations, and custom icons.
  - Complete registration and activation flow for new users.
- **🛠️ Developer Experience & Architecture**
  - New `@Body` and `@ValidateBody` decorators to centralize and formalize API request schema validation.
  - Streamlined backend and frontend developer skill personas and workflow documentation.
  - Expanded E2E integration test coverage for task flows.

---

## Milestone 3 — Content & Media Core

> Hierarchical content engine and direct-to-storage media pipeline.

### New Features

- **🌳 Hierarchical Topic Engine**
  - Unlimited depth parent-child relationships for curriculum building.
  - Interactive Admin Topic Tree with drag-and-drop reordering/re-parenting.
  - Draft/Published/Archived lifecycle for granular visibility control.

- **📁 Media & Storage System**
  - Direct-to-R2 upload strategy via presigned URLs (zero-byte Worker overhead).
  - Native support for PDF, MP4 Video, and Image assets.
  - Secure media serving via short-lived presigned download URLs.

- **🛡️ Security & Content Integrity**
  - Isomorphic Markdown sanitization (backend persistence + frontend rendering).
  - Strict filtering ensures students only see published nodes and ready media.
  - Content-type and size enforcement on presigned upload requests.

- **💻 Dashboards & Viewers**
  - Admin Authoring Pane: Inline editing, tag management, and real-time upload progress.
  - Student Catalogue: Responsive sidebar navigation and specialized media viewers.

---

## Milestone 2 — Auth Hardening (Security Epic S-01 → S-10)

> All findings from the Milestone 2 close-out security audit are now closed.
> See [`docs/product/milestones/2-extends-auth-hardening/auth-hardening.story.md`](product/milestones/2-extends-auth-hardening/auth-hardening.story.md) for the full story.

### Security fixes

- **S-01 (High) — Refresh tokens hashed at rest** *(commit `8dde48b`)*  
  Refresh tokens are now persisted as a SHA-256 digest (hex). A table-truncating migration
  (`0004_hash_refresh_tokens.sql`) is required on deploy — all active sessions will be forced
  to re-authenticate once after the migration runs.

- **S-02 (Medium) — Session revocation on admin mutations** *(commit `5697266`)*  
  `PATCH /admin/users/:id` and `DELETE /admin/users/:id` now call `deleteAllForUser` whenever
  a user is deactivated or their roles change. Deactivated accounts can no longer use stale
  refresh tokens. Admin mutations emit an audit log line `{event, userId, actor, at}` at
  `console.info`.

- **S-03 (Medium) — Constant-time login** *(commit `fe3cf09`)*  
  `POST /auth/login` now runs a full PBKDF2 verification against a pre-computed dummy hash
  when the requested email does not exist in the database. Login response time no longer
  reveals whether an email is registered.

- **S-04 (Medium) — Login rate limiting & lockout** *(commit `64d7208`)*  
  Failed attempts are counted per `(email, ip)` tuple via a new `IRateLimiter` port backed
  by Cloudflare KV. After 5 failures in 10 minutes the tuple is locked for 15 minutes and
  the endpoint returns `429 Too Many Requests` with a `Retry-After` header. Successful login
  clears the counter. The limiter fails open on KV errors.  
  **Operator action required:** provision a `RATE_LIMIT_KV` KV namespace with
  `wrangler kv:namespace create RATE_LIMIT_KV` and update the placeholder `id` in
  `wrangler.jsonc` before deploying.

- **S-05 (Low) — Admin lockout prevention** *(commit `9ba9c44`)*  
  `PATCH` and `DELETE /admin/users/:id` now reject changes that would leave zero active
  admins (`409 WOULD_LOCK_OUT_ADMINS`) or that target the acting admin's own account
  (`409 SELF_LOCKOUT`).
