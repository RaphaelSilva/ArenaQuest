# Task 04 — Badge Data Layer + Seeded Catalog + Admin CRUD

**Status:** ✅ Done
**Milestone:** [7](./milestone.md)

## Summary

Add the badge catalog (`badges`), per-user earned records (`user_badges`), and admin CRUD endpoints. Seed the badges shown in the Dashboard and Content wireframes ("Alicerce Sólido", "Levantador Bronze", "Semana Perfeita", …).

## Dependencies

None. Consumed by Task 09 (unlock engine) and Task 10 (`/me/badges`).

## Technical Constraints

- `badges (id, slug, name, icon_emoji, description, xp_reward, rule_kind, rule_params, active)`. Supported `rule_kind` in M7 listed in `milestone.md §2.4`.
- `user_badges (id, user_id, badge_id, earned_at)` with unique on `(user_id, badge_id)`.
- New `IBadgeRepository` port + D1 adapter.
- Admin CRUD routes under `/admin/badges`; `requireRole('admin', 'content_creator')`.
- Seed migration populates the catalog with at least the eight badges in `Dashboard.html`.

## Scope

In:
- Migrations, seed, port, adapter, controller, routes, tests.
- Zod validation for create/update.

Out:
- Awarding logic (Task 09).
- Participant-facing UI rendering (Task 13).

## Acceptance Criteria

- [x] Seed migration produces the 8 badges from `Dashboard.html` with matching slugs and emojis.
- [x] `POST /admin/badges` rejects unknown `rule_kind` with `400`.
- [x] Awarding the same badge to the same user twice is a no-op (DB-level unique enforced; repository returns the existing row).
- [x] No provider-specific imports outside adapters.

## Verification Plan

1. `make db-migrations-dev` followed by `SELECT COUNT(*) FROM badges WHERE active = 1` ≥ 8.
2. Vitest covers admin auth, validation, and idempotent award.
3. `make lint` and `make test-api` pass.
