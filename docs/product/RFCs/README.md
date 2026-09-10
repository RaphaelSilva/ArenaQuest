# RFCs (Request for Comments)

Formal proposals and architectural decisions for ArenaQuest. An RFC argues for a
change — the why, the alternatives, the tradeoffs. What was actually built from
it lives in the linked milestone, and is summarised in
[`../FEATURES.md`](../FEATURES.md).

## Index

| RFC | Title | Status | Milestone | Date |
|-----|-------|--------|-----------|------|
| [0001](./0001-apps-api-test-suite-optimization.md) | `apps/api` test-suite optimization | ✅ Implemented | [M8](../milestones/8-api-test-optimization/milestone.md) | 2026-05-24 |
| [0002](./0002-frontend-internationalization-i18n.md) | Frontend internationalization (i18n) strategy | ✅ Implemented | [M10](../milestones/10-frontend-i18n/milestone.md) | 2026-05-24 |
| [0003](./0003-apps-api-route-organization-and-openapi.md) | `apps/api` route reorganization and OpenAPI adoption | ✅ Implemented | [M9](../milestones/9-api-routes-openapi/milestone.md) | 2026-05-24 |
| [0004](./0004-catalog-redesign.md) | Catalog page redesign — wireframe-aligned UX | ✅ Implemented | [M11](../milestones/11-catalog-redesign/milestone.md) | 2026-05-27 |
| [0005](./0005-enrollment-exclusions-and-visibility.md) | Enrollment strategy — topic exclusions and node visibility | ✅ Implemented | [M12](../milestones/12-enrollment-visibility/milestone.md) | 2026-05-28 |
| [0006](./0006-white-label-branding-and-build-tooling.md) | White-label branding | ✅ Implemented | [M13](../milestones/13-white-label-branding/milestone.md) | 2026-06-19 |
| [0007](./0007-deployment-preflight-and-config-validation.md) | Deployment preflight & configuration validation | 🚧 Partial | [M14](../milestones/14-deployment-preflight-configuration-validation/milestone.md) | 2026-06-19 |
| [0008](./0008-user-dashboard-with-topic-recommendations-and-badge-achievem.md) | User dashboard with topic recommendations and badge achievements | 📝 Draft | — | 2026-06-20 |
| [0009](./0009-gamification-catalog-administration.md) | Gamification catalog administration | ✅ Implemented | [M15](../milestones/15-gamification-catalog-administration/milestone.md) | 2026-06-23 |
| [0010](./0010-player-progression-administration.md) | Player progression administration | ✅ Implemented | [M16](../milestones/16-player-progression-administration/milestone.md) | 2026-06-23 |
| [0011](./0011-branded-deploy-cli-label-parametrized-ci-independent-release.md) | Branded deploy CLI — label-parametrized, CI-independent release | ✅ Implemented | [M17](../milestones/17-branded-deploy-cli/milestone.md) | 2026-07-23 |
| [0012](./0012-tenant-provisioning-backend-parity.md) | Tenant provisioning — Cloudflare bring-up with backend parity | ✅ Implemented | [M18](../milestones/18-tenant-provisioning-backend-parity/milestone.md) | 2026-08-08 |
| [0013](./0013-student-billing-contracts-and-receivables-accounting.md) | Student billing, contracts and receivables accounting | Approved | — | 2026-09-10 |

Milestones 1–7 predate this process and derive directly from
[`../specification.md`](../specification.md).

## RFC Process

### When to file an RFC
- Major architectural decisions affecting multiple apps/packages
- New features requiring cross-team coordination
- Breaking changes or significant refactors
- Technology choices (libraries, frameworks, patterns)

### Structure
Use the structure of any RFC in this directory:
**Summary** · **Motivation** · **Proposed Solution** · **Alternatives Considered**
· **Implementation Plan** · **Tradeoffs & Risks** · **Success Criteria**.

### Status lifecycle
| Status | Meaning |
|---|---|
| 📝 Draft | Work in progress, not yet ready for review |
| Proposed | Under discussion, awaiting review |
| Approved | Consensus reached, ready for implementation |
| In Progress | A milestone is executing it |
| ✅ Implemented | Built and merged; the milestone column points at what was built |
| 🚧 Partial | Partly built, or built in a different shape than proposed — the row says how |
| Rejected | Decided not to pursue |
| Superseded | Replaced by a newer RFC |

Keep the status in the RFC's own header and this table in sync. Both are stated
against the code in `main`, not against intent.

## Discussion

RFCs are reviewed in architecture reviews, standups, and asynchronous comments on
GitHub pull requests. Approval requires sign-off from the product owner
(roadmap alignment), the lead architect (cloud-agnostic compliance, Ports &
Adapters fit), and affected team leads (feasibility).
