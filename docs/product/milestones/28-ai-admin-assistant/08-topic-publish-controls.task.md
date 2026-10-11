# Task 08 — Frontend: Topic publish controls follow the role (Phase 2)

**Status:** 📝 Open
**Milestone:** [28 — AI Admin Assistant](./milestone.md)
**RFC:** [RFC 0025](../../RFCs/0025-ai-admin-assistant.md)
**Team:** Frontend Web
**Depends On:** [Task 07](./07-topic-publish-gate.task.md)

## Summary

Brings the topics backoffice in line with Task 07's gate so a content creator never meets a
`403` they could not have predicted. On `/admin/topics`, the status control stops offering
**Published** to a session without the `admin` role (both when creating and when editing a
topic); `draft` and `archived` remain. If the API refuses anyway (stale role, race), the API's
message is shown inline instead of a generic failure. An admin sees no difference. The pattern is
the events backoffice's `PublishControls` / `canPublish`, derived from the session's roles. All
new strings exist in both dictionaries.

## Dependencies

- [Task 07](./07-topic-publish-gate.task.md) — hard dependency: the contract (the `403` on publish
  for content creators) this UI follows. Ship together or after it.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/app/(protected)/admin/topics/page.tsx` and
    `apps/web/src/app/(protected)/admin/topics/__tests__/**`.
  - `apps/web/src/components/admin/topics/**` — only if the status control is extracted into a
    component.
  - `apps/web/src/i18n/dict-en.ts` and `dict-pt.ts` — identical new keys.
- **Role from the session.** Use the existing session/role source the events backoffice uses; no
  new API call to discover the role.
- **No hardcoded user-facing strings** — `check-i18n-coverage.js` stays green.
- **No API change.** The contract is Task 07's; this task only follows it.

## Scope

In:
- Hiding/disabling the publish option for non-admins, the inline refusal message, tests for both
  roles, the dictionary keys.

Out:
- Any API change — Task 07.
- Changing how archive, move or delete work in the UI.

## Acceptance Criteria

- [ ] Rendered with a `content_creator` session, the topic status control offers no "Published"
      option on create or edit (component test).
- [ ] Rendered with an `admin` session, "Published" is offered and saving it calls the API with
      that status.
- [ ] A mocked `403` on save shows the API's message inline and keeps the form's values.
- [ ] Both dictionaries carry identical keys; `check-i18n-coverage.js` passes.
- [ ] `make lint` and `make test-web` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make test-web` — the topics page tests.
2. `make dev`; log in as the seeded content creator and as the admin, open `/admin/topics`, and
   compare the status control.
3. `git diff --stat` confirms only scope-guardrail files changed.
