# Release Notes

## Unreleased

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

---

## Milestone 4 — Task Engine & Interconnection

> The engagement engine: enabling content creators to design multi-stage tasks and link them to the knowledge tree.

### New Features

- **📝 Task Authoring Engine**
  - First-class `Task` entity with draft/published/archived lifecycle.
  - Ordered `TaskStage` entities with human-readable labels (e.g., Reading, Practice, Completion).
  - Admin Authoring UX: List, create, edit tasks, and reorder stages using an intuitive drag-and-drop interface.

- **🔗 Interconnection & Referential Integrity**
  - Robust N-to-N linking between tasks and topics from the knowledge tree.
  - Stage-level subset linking allowing specific stages to target specific topics.
  - Strict referential integrity: tasks cannot be published without stages, and linked topics must be published.

- **👨‍🎓 Student Surface**
  - Read-only `/tasks` dashboard showing published tasks.
  - Deep-linking from task stages directly into the knowledge catalog (`/catalog/:topicId`).

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
> See [`docs/product/milestones/2-extends/auth-hardening.story.md`](product/milestones/2-extends/auth-hardening.story.md) for the full story.

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

