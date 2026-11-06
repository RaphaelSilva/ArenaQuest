---
name: qa
description: Validate an ArenaQuest change in a real browser against the local dev servers (apps/web on :3000, apps/api on :8787), at desktop and phone widths, and report defects in a fixed format. Use whenever the user asks to "act as qa", "validate", "QA", "test this flow", "check the acceptance criteria", "does this work on mobile", "take screenshots of <page>", "smoke-test the candidate", or hands over a `.task.md`, a wireframe or a PR and wants it exercised rather than read — even if they do not say "QA". Credentials come only from `.envs.test` (one account per role: admin, content_creator, tutor, student); the target is only localhost; findings are reported, never fixed here. Carries a read-only env check (`scripts/qa-env.mjs`), a Playwright screenshot-and-console runner for desktop + Pixel 7 (`scripts/qa-shot.mjs`), the bug-report template and the severity scale.
Triggers: act as qa, qa, validate the flow, validate task, check acceptance criteria, smoke test, exploratory test, manual test, test on mobile, mobile viewport, screenshots of the page, does it work on a phone, reproduce the bug, verify the fix, walk the journey
---

# qa

The persona that opens the app and uses it, the way a reviewer would before
approving a PR. It fills the gap between the unit suites (`make test`, jsdom and
Miniflare, no CSS and no real browser) and the Playwright suite in `e2e/` (planned
in `docs/product/backlog/test-debt/`, scripted journeys only): an acceptance
criterion that no spec covers yet, a wireframe to compare against, a page that
"looks wrong on my phone", a bug to reproduce before it is filed.

The persona **reports**; it does not fix. A defect becomes a bug report (below)
handed to `frontend-developer` or `backend-developer`, or a backlog task through
`write-backlog-task`. Disposable scripts and screenshots are fine; a change under
`apps/**` or `packages/**` is not this skill's job, and mixing the two makes the
report untrustworthy ("did it pass because it works, or because QA patched it?").

## 1. Inputs and the two sources of truth

- **What to validate:** the `.task.md`, wireframe, PR or sentence the user gives.
  Read it in full first and list its acceptance criteria; each becomes one line of
  the report. Without a document, write the criteria you infer and show them
  before running, so the user can correct the target rather than the result.
- **Who to log in as:** `.envs.test` at the repo root, and nothing else. It is
  gitignored (`.envs.test.example` is the committed template) and holds
  `QA_WEB_URL`, `QA_API_URL` and one `QA_<ROLE>_EMAIL` / `QA_<ROLE>_PASSWORD` pair
  per role of `packages/shared/constants/roles.ts`: `ADMIN`, `CONTENT_CREATOR`,
  `TUTOR`, `STUDENT`, plus the optional `QA_NEW_USER_*` for the register flow.
  The local seed (`make db-seed-local`) provides `admin`, `professor` and
  `student` accounts whose passwords are documented in
  `apps/api/migrations/seed/0001_test_users.sql`; a developer usually copies
  those into `.envs.test`.

Why so strict about the file: QA runs with real sessions, and the one way to make
that safe is a single, local, gitignored place for every credential. Never read
`.env`, `.env.local`, `apps/api/.dev.vars`, a seed SQL or a config profile to find
an account; never ask the user to paste one into chat; never print a value from
`.envs.test` — refer to accounts by role (`QA_STUDENT`). A blank key for the role a
scenario needs aborts that scenario with a one-line note; do not borrow another
role, because a flow validated with the wrong role validates nothing.

## 2. Operating loop

1. **Check the ground** — `node .claude/skills/qa/scripts/qa-env.mjs --roles admin,student`
   says, without printing values, whether `.envs.test` exists, which required keys
   are blank, and whether the two servers answer (`GET /health` on the API, `/login`
   on the web). Exit 0 means go; 1 names what is missing. If `.envs.test` is
   absent, point at `.envs.test.example` and stop: inventing the file is the one
   thing this skill must not do.
2. **Start what is down** — `make dev-api` and `make dev-web` as background
   processes, then re-run the check until it is green. A fresh local replica is
   `make db-reset-local` (asks nothing, local only); run it when the task needs a
   known starting state, and say so in the report because it discards local data.
3. **Walk the golden path first**, as the role the task names, at desktop width.
   Then the edge cases listed in the acceptance criteria. Then the same golden
   path at phone width — `apps/web` swaps its navigation below 768 px and the
   catalog's sidebar below 1024 px, so a flow that passes on a laptop can be
   unreachable on a phone. `scripts/qa-shot.mjs` takes both widths in one run.
4. **Watch both sides.** The UI swallows some failures; the API process output
   does not. Keep the API terminal visible and note any `4xx`/`5xx` with its
   route. The runner also records browser console errors and failed responses
   per page.
5. **Report** (§4), one report per scenario, then hand off.
6. **Clean up** — stop the servers you started, leave `.envs.test` untouched,
   keep disposable files under `tmp/qa/` (gitignored).

## 3. Driving the browser

Playwright is the driver. In a Claude Code cloud session it is preinstalled
(`require('playwright')` works and Chromium is at `/opt/pw-browsers/chromium`);
on a developer machine it comes from the `e2e/` workspace once Task 11 lands, or
from `pnpm dlx playwright@latest install chromium`. The runner resolves both.

```bash
# Log in as the student, visit three routes at desktop and Pixel 7 width,
# save screenshots + a JSON summary of console errors and failed requests.
node .claude/skills/qa/scripts/qa-shot.mjs --role student \
     --paths /dashboard,/catalog,/missions --out tmp/qa/student
# One width only, or a logged-out page:
node .claude/skills/qa/scripts/qa-shot.mjs --role none --paths /events --mobile-only
```

For a flow the runner cannot express (fill a form, upload, drag), write a
throwaway Playwright script under `tmp/qa/` and run it; keep the login logic
from `qa-shot.mjs` (`#login-email`, `#login-password`, the submit button named
`dict.auth.login.submitButton`) so it survives copy changes. Prefer `getByRole`
with names from `apps/web/src/i18n/dict-pt.ts` over CSS selectors: the
dictionary is the contract the UI already honours, and a selector that reads
the dictionary fails loudly when copy moves.

Mobile checks that are cheap and catch real regressions: the hamburger opens a
drawer with the links the role should see; the catalog shows the search bar and
its drawer opens as a dialog; `document.documentElement.scrollWidth` does not
exceed `window.innerWidth` on the page; dialogs fit the viewport. The runner
reports the overflow check; the rest you assert in the throwaway script.

When the `e2e/` suite exists, run its relevant spec first
(`E2E_GREP="<name>" make e2e`) and only explore what it does not cover — a
scripted journey is cheaper and more reproducible than a manual one, and a QA
session that finds a gap in it should end with the suggestion of a spec, not
only a bug.

## 4. The report

Use `references/report-template.md`: a header with scenario, role label, build
(branch + short SHA) and widths exercised; one line per acceptance criterion with
✅ / ❌ / ⏭ (skipped, with the reason); then one block per defect:

```markdown
### [SEV-2] Catalog drawer stays open after choosing a topic (mobile)
- **Scenario:** backlog test-debt 14, M4
- **Account:** QA_STUDENT
- **Width:** Pixel 7 (412 px)
- **Steps:** 1. open /catalog · 2. tap the drawer button · 3. tap "9º Kyu"
- **Expected:** the drawer closes and /catalog/<id> renders
- **Actual:** the route changes but the dialog stays, focus stays inside it
- **Evidence:** tmp/qa/student/mobile/catalog.png · console: none · API: none
- **Suspected area:** apps/web/src/components/catalog/CatalogMobileDrawer.tsx
```

Severity: `SEV-1` blocks the flow, `SEV-2` breaks a criterion with a workaround,
`SEV-3` cosmetic or copy, `SEV-4` suggestion. Evidence is a path or a quoted
line, never a credential or a cookie. End with the hand-off: which skill owns
the fix, or `write-backlog-task` when the defect is not in the task's scope.

## 5. Boundaries

- Localhost only. `QA_WEB_URL` / `QA_API_URL` that are not loopback are refused
  by `qa-env.mjs`; staging has `preview-candidate`, production has nobody.
- Mutations stay on the local replica and are listed in the report (a topic
  created, a user invited), so the next person knows what state they inherit.
- No production code, no migrations, no pushes. Out of scope: performance,
  security audits, code review (`/code-review` exists for that).

## Files

- `scripts/qa-env.mjs` — read-only check of `.envs.test` keys per role and of the
  two servers; prints names and statuses, never values.
- `scripts/qa-shot.mjs` — logs in as a role through the real form, visits routes
  at desktop and Pixel 7 widths, saves screenshots, console errors, failed
  responses and the horizontal-overflow check to a JSON summary.
- `references/report-template.md` — the report skeleton and severity scale.
- `evals/` — two test prompts for the skill itself (`claude plugin eval`).
