# Milestone {{NUM}} — {{TITLE}}

**Status:** {{STATUS}}
**Scope:** `app/or/package` (what this touches), … . Derived from [RFC {{RFC_NUM}}]({{RFC_REL}}).

> **Hard scope guardrail — read before opening any task.** One dense paragraph
> that turns the RFC's Goals and Non-Goals into a fence. State (a) exactly which
> files / directories this milestone may touch — list them — and (b) the things
> it is explicitly **not** an opportunity to do, naming each Non-Goal from the
> RFC. End with: "If a refactor opportunity is spotted outside this scope, file a
> separate task — do not bundle it." This blockquote is what stops scope creep
> once the tasks are being implemented; make it specific enough that a reviewer
> can reject an out-of-scope diff by quoting it.

---

## 1. Objectives

The outcomes this milestone commits to — each a bullet that a task (or two) will
deliver. Lift them from the RFC's Goals and Proposed Design; phrase each as a
concrete, verifiable result, not an activity. Bold the lead clause.

- **<Outcome>.** Why it matters / what it fixes, in one line.

Out of scope (explicit, from RFC {{RFC_NUM}} Non-Goals):
- **<Non-Goal>** — where it lives instead (a Deferred section, the backlog, a
  future RFC), and one line on why it's excluded here.

---

## 2. Functional Requirements

Observable behaviour the system must exhibit once this ships — the "what works"
list, written so QA can read each line and check it. One requirement per bullet,
no implementation detail. Cover the API surface, the data rules, the UI states,
and any cross-cutting contract (i18n, auth, rate limit) the RFC pins.

---

## 3. Acceptance Criteria

Testable assertions, each a `- [ ]` checkbox. These are stricter than the
Functional Requirements: each one names the concrete signal that proves it
(a specific endpoint response, a migrated row, a passing script, a deleted
directory). Include the gate commands the milestone must keep green
(`make lint`, `make test-api`, `make test-web`) and a "no diff outside scope"
line tied to the guardrail.

- [ ] <Specific, observable assertion with the exact signal that proves it.>

---

## 4. Specific Stack

The concrete technology each layer uses for this milestone — so a task author
doesn't re-derive it. Keep it to the layers this milestone actually touches.

- **Backend:** Cloudflare Workers + Hono; per-request adapters in `buildApp(env)`;
  controllers return `ControllerResult<T>`; validation via `@ValidateBody` / `@Body`.
- **Shared:** which `packages/shared` types / ports change.
- **Frontend:** Next.js 15 App Router, React 19, Tailwind CSS v4; both i18n
  dictionaries; `check-i18n-coverage.js`.
- **Tests:** Vitest + `@cloudflare/vitest-pool-workers` (API); Vitest + RTL (web).

---

## 5. Task Breakdown

The execution plan. Each row is a `.task.md` file authored separately with
`task-writer` — split backend and frontend into distinct tasks (frontend gets
the `--frontend` suffix and depends on its backend task). Fill the table once
the task files exist; keep the dependency graph and recommended order in sync.

| # | Task File | Phase | Team | Status |
|---|-----------|-------|------|--------|
| 01 | [<title>](./01-<slug>.task.md) | 0 | Backend | ☐ Open |

Dependency graph:

```
01 (independent)
      │
      ▼
02 ──► 03
```

**Recommended execution order:** `01` → `02` → `03`.

Each task is intended to land as an independent PR with `make lint`,
`make test-api`, and `make test-web` passing.

---

## 6. Decisions recorded (from RFC {{RFC_NUM}} "Resolved Decisions")

Pin the decisions the RFC already settled so implementers don't reopen them.
Number each; one line of decision + one line of rationale. If the RFC has a
"Resolved Decisions" section, copy its entries here; if it has open questions
that must be answered before tasks start, resolve them with the author and
record the answer (with who decided) rather than leaving them dangling.

1. **<Decision>** — <rationale / what it rules out>.

---

## 7. Definition of Done (milestone level)

- [ ] All tasks marked Done with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint`, `make test-api`, and `make test-web` pass green.
- [ ] Closeout note written at `./closeout-analysis.md`.
- [ ] RFC {{RFC_NUM}} status set to `Implemented` in its header and
      `docs/product/RFCs/README.md`; deferred items remain backlog.
- [ ] No diff outside the scope declared in the guardrail.
