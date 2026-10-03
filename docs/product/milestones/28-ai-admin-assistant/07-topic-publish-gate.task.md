# Task 07 — Backend: Admin-only topic publish gate (Phase 2)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0023](../../RFCs/0023-ai-admin-assistant.md)
**Team:** Backend API

## Summary

Makes publishing a topic an **admin** act, exactly as publishing an event already is. On
`POST /v1/admin/topics` and `PATCH /v1/admin/topics/{id}`, a body carrying
`status: 'published'` requires the `admin` role; a `content_creator` receives `403`. Every other
write — drafts, edits, `archived`, moves, media — stays open to both staff roles. This is the
server-side layer of the assistant's "never publishes" guarantee (RFC 0023 §2, layer 3): the
`aq-mcp` account is a content creator, so no tool path can publish even if a tool were wrong.
The gate follows the events precedent (`publishGate`, `routes/admin/events.ts`), extended to the
create route because topics, unlike events, accept a status on create. **Before merging, the
owner confirms milestone Decision 6** (no real content creator publishes topics today); if one
does, this task is re-scoped to the assistant's account only.

## Dependencies

- None — independent. Gated on the owner's confirmation of milestone Decision 6.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/api/src/routes/admin/topics.ts` — the gate on create and update.
  - `apps/api/src/routes/admin/events.ts` — only if the gate is lifted into a shared middleware
    both routers import; behaviour for events unchanged.
  - `apps/api/src/middleware/**` — that shared middleware, if extracted.
  - `apps/api/openapi.json` — regenerated (the `403` response documented).
  - `apps/api/test/**`.
  - `CLAUDE.md` — one line noting topic publish is admin-only.
- **Payload-conditional, not router-wide.** A router-wide `requireRole(ADMIN)` would lock content
  creators out of drafts; the gate inspects the status only.
- **Validator still owns `400`.** A non-JSON body passes through the gate to the validator, as in
  the events gate.
- **No data change.** Already-published topics stay published; no migration.

## Scope

In:
- The gate on both routes, the documented `403`, specs for both roles × both routes × each
  status, and the events specs re-run if the middleware is shared.

Out:
- Backoffice controls — Task 08.
- Any change to who may archive, move or delete topics.

## Acceptance Criteria

- [ ] `content_creator`: `POST` with `status: 'published'` → `403`; `PATCH` to `published` → `403`;
      the topic is unchanged afterwards.
- [ ] `content_creator`: create as `draft`, edit, and `PATCH` to `archived` still succeed.
- [ ] `admin`: create published and `PATCH` to `published` succeed.
- [ ] Event publish behaviour is unchanged (existing events specs green).
- [ ] A non-JSON body still yields the validator's `400`, not a gate error.
- [ ] `openapi.json` regenerated; `make lint` and `make test-api` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-api` — topic and event admin specs.
2. `make dev-api`; with a content-creator token, try to publish via both routes; with an admin
   token, succeed.
3. `git diff --stat` confirms only scope-guardrail files changed.
