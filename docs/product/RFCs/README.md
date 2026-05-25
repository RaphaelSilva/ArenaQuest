# RFCs (Request for Comments)

This directory contains formal proposals and architectural decisions for ArenaQuest.

## Index

| RFC | Title | Status | Date | Author |
|-----|-------|--------|------|--------|
| [0001](./0001-apps-api-test-suite-optimization.md) | API Test Suite Optimization | Proposed | — | — |
| [0002](./0002-frontend-internationalization-i18n.md) | Frontend Internationalization (i18n) Strategy | Proposed | 2026-05-24 | Claude Code |

## RFC Process

### When to File an RFC
- Major architectural decisions affecting multiple apps/packages
- New features requiring cross-team coordination
- Breaking changes or significant refactors
- Technology choices (libraries, frameworks, patterns)

### RFC Template
Use the structure from any RFC in this directory:
- **Summary** — one-paragraph overview
- **Motivation** — why this is needed
- **Proposed Solution** — technical approach
- **Alternatives Considered** — other options and why they were rejected
- **Implementation Plan** — phases and effort estimate
- **Tradeoffs & Risks** — what we're giving up and how to mitigate
- **Success Criteria** — how to measure if it worked

### Status Lifecycle
- **Proposed** — Under discussion, awaiting review
- **Approved** — Consensus reached, ready for implementation
- **In Progress** — Implementation underway
- **Completed** — Merged and deployed
- **Rejected** — Decided not to pursue
- **Superseded** — Replaced by a newer RFC

## Discussion

RFCs are reviewed during:
- Architecture review meetings
- Team standups
- Asynchronous comments in GitHub pull requests (if from a branch)

Approval requires sign-off from:
- Product owner (alignment with roadmap)
- Lead architect (cloud-agnostic compliance, Ports & Adapters fit)
- Affected team leads (engineering feasibility)
