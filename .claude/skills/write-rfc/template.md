# RFC {{NUM}}: {{TITLE}}

**Date:** {{DATE}}
**Status:** {{STATUS}}
**Author:** {{AUTHOR}}
**Affected:**
- `path/to/affected/file.ts` (what changes here and why)

---

## Summary

One paragraph. What this proposes and the single most important consequence.
A reader should grasp the whole change from this alone.

## Motivation

Why this is needed now. Concrete cases, not abstractions. A small table of
"Case → covered by this RFC?" works well when there are several scenarios.

## Goals & Non-Goals

**Goals**
- The specific outcomes this RFC commits to.

**Non-Goals**
- What is explicitly out of scope (and, ideally, where it lives instead — a
  backlog item, a deferred section, or a future RFC).

## Current State (for reference)

How things work today — code paths, schema, the exact line that misbehaves.
Cite `path/file.ts:line`. Omit this section only if the area is greenfield.

## Proposed Design

The technical approach, in numbered subsections when it spans several axes
(schema, resolver, ports, HTTP surface, frontend, …). Show the real types,
SQL, or route signatures. Be specific enough to implement from.

## Alternatives Considered

Numbered. For each: the option, and **why it was rejected or deferred** (not
just that it was). "Deferred, not rejected" is a valid outcome — say which.

## Implementation Plan

Phased, each phase independently shippable where possible, with a rough effort
estimate. State the total up front (e.g. "~3 dev days").

### Phase 0 — <prerequisite, if any> (~X)
### Phase 1 — <…> (~X)

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| What we give up / what could go wrong | How it's bounded or recovered |

## Success Criteria

How we know it worked — observable, testable assertions. Tie each to a phase
where useful.

## Open Questions

Unresolved decisions, and who owns them. Move answered ones to a "Resolved
Decisions" section (with date + decider) rather than deleting the history.

## References

- Relevant code: `path/file.ts:line`
- Related RFCs: RFC NNNN (<what it owns>)
