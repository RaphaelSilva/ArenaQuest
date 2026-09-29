# Epic: {{TITLE}}

**Date:** {{DATE}}
**Status:** {{STATUS}}
**Author:** {{AUTHOR}}
**Derived from:** {{DERIVED}}
**Affected:**
- `path/to/affected/area` (what changes here and why)

> **Scope guardrail — read before opening any task.** One dense paragraph that
> fences this epic: (a) exactly which apps / packages / directories it may touch,
> and (b) what it is explicitly **not** an opportunity to do, naming each
> Non-Goal below. End with: "If a refactor opportunity is spotted outside this
> scope, file a separate task — do not bundle it."

---

## Summary

One paragraph. What this epic delivers and the single most important
consequence. An epic is a body of work too large for one task and too small, or
too cross-cutting, for a numbered milestone — say which, and why an epic.

## Motivation

Why now. Concrete cases, not abstractions. A small "Case → covered by this
epic?" table works well when there are several scenarios.

## Goals & Non-Goals

**Goals**
- The specific outcomes this epic commits to, each verifiable.

**Non-Goals**
- What is explicitly out of scope, and where it lives instead (backlog item,
  a future epic, an RFC).

## Current State (for reference)

How things work today — code paths, the exact file and line that misbehaves.
Cite `path/file.ts:line`. Omit this section only if the area is greenfield.

## Proposed Approach

The technical approach, in numbered subsections when it spans several axes.
If this epic derives from an RFC, summarise the RFC's design and link to it
rather than restating it — the RFC stays the source of truth for the *why*.

## Task Breakdown

Tasks live next to this file as `NN-<slug>.task.md` (backend and frontend in
separate files). Keep this table in sync with them.

| # | Task | Team | Depends on | Status |
|---|---|---|---|---|
| 01 | <task title> | backend | — | 📝 Open |

Recommended order / dependency graph, one line per wave.

## Acceptance Criteria

Observable, testable assertions that say the epic is done — each a checkbox a
reviewer can tick against `main`.

- [ ] <criterion>

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| What we give up / what could go wrong | How it's bounded or recovered |

## Open Questions

Unresolved decisions and who owns them. Move answered ones to a "Resolved
Decisions" subsection (with date + decider) rather than deleting the history.

## References

- Relevant code: `path/file.ts:line`
- Related RFCs / milestones / epics
