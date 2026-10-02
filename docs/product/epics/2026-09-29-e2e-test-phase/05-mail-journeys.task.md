# Task 05 — Frontend: Console-mail reader and journeys J3, J4

**Status:** 📝 Open
**Epic:** [End-to-end test phase — Playwright suite gating main](./2026-09-29-e2e-test-phase.epic.md)
**Team:** Frontend Web
**Depends On:** [Task 02](./02-fixtures-and-page-objects.task.md)

## Summary

Cover the two account journeys that go through e-mail, without real e-mail. The E2E
API runs with the console mailer, whose output is the `[mail] to=<address>
subject=<json>` line followed by the message text; a mail helper reads the captured API
output (task 01 pipes it to a log under `e2e/.state/`) and waits until a message for a
given address contains a link matching a pattern. **J3 — register and activate:** an
anonymous visitor registers with a `uniq()` address, the activation link is read from
the log, the visitor opens it, activates the account and logs in for the first time.
**J4 — password reset:** a user created for the test requests a reset from
`/forgot-password`, opens the reset link, sets a new password, cannot log in with the
old one and can with the new one. Both journeys create their own users, never touching
the shared seeded accounts.

## Dependencies

- [Task 02](./02-fixtures-and-page-objects.task.md) — hard dependency: API client
  (to create the J4 user) and page objects.
- [Task 01](./01-e2e-workspace-and-stack-boot.task.md) — the API output log and
  `MAIL_DRIVER=console` in `.dev.vars.e2e`.
- Existing behaviour: `apps/api/src/adapters/mail/console-mail-adapter.ts`,
  `apps/web/src/app/(auth)/{activate,forgot-password,reset-password}/`.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `e2e/fixtures/mail.ts` (new) and its registration in the extended `test`.
  - `e2e/specs/auth/**` — J3 and J4.
  - `e2e/pages/**` — register, activate, forgot-password and reset-password page
    objects.
  - `apps/api/test/**` — one unit test pinning the console mailer's line format, so
    the helper's contract is protected on the API side.
- **Parallel-safe.** The helper matches on the recipient address, so concurrent
  specs never read each other's mail.
- **No new mail driver.** If reading the log proves unreliable, raise it; a file
  driver is a separate, reviewed change.
- **No secrets in output.** The helper returns only the link, never logs the full
  message body to the test report.
- **Rate limits.** Register, activate and forgot-password are rate limited; each
  spec stays within one attempt per address and the suite's total stays below the
  limits.

## Scope

In:
- The mail helper with a bounded wait and a clear timeout message.
- J3 and J4 specs and the page objects they need.
- The API unit test pinning the console mail format.

Out:
- Google OAuth — out of the epic.
- Any change to mail adapters or auth routes.

## Acceptance Criteria

- [ ] J3 passes: a new address registers, activates through the logged link and
      reaches the authenticated area.
- [ ] J4 passes: after reset the old password is rejected and the new one works.
- [ ] Running J3 and J4 in parallel with `--repeat-each=3` stays green.
- [ ] Changing the console mailer's line format fails the new API unit test.
- [ ] `make test-api` and `make lint` green.
- [ ] No diff outside the scope guardrail.

## Verification Plan

1. `make e2e` filtered to `e2e/specs/auth` — both journeys green.
2. Same with `--repeat-each=3 --workers=2`.
3. Temporarily alter the console mail format — the API unit test fails; revert.
4. `make test-api` and `make lint`.
5. `git diff --stat` confirms only scope-guardrail files changed.
