# RFCs (Request for Comments)

This directory contains formal proposals and architectural decisions for ArenaQuest.

## Index

| RFC | Title | Status | Date | Author |
|-----|-------|--------|------|--------|
| [0001](./0001-apps-api-test-suite-optimization.md) | Otimização da suíte de testes de `apps/api` | Draft | 2026-05-24 | raphaelsilva |
| [0002](./0002-frontend-internationalization-i18n.md) | Frontend Internationalization (i18n) Strategy | Implemented | 2026-05-24 | Claude Code |
| [0003](./0003-apps-api-route-organization-and-openapi.md) | Reorganização de rotas e adoção de OpenAPI/Swagger em `apps/api` | Draft | 2026-05-24 | raphaelsilva |
| [0004](./0004-catalog-redesign.md) | Catalog page redesign — wireframe-aligned UX | Implemented | 2026-05-27 | raphaelsilva |
| [0005](./0005-enrollment-exclusions-and-visibility.md) | Enrollment strategy review — topic exclusions and node visibility | Implemented | 2026-05-28 | raphaelsilva |
| [0006](./0006-white-label-branding-and-build-tooling.md) | White-label branding | Draft | 2026-06-19 | raphaelsilva |
| [0007](./0007-deployment-preflight-and-config-validation.md) | Deployment preflight & configuration validation | Draft | 2026-06-19 | raphaelsilva |

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
- **Draft** — Work in progress, not yet ready for review
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
