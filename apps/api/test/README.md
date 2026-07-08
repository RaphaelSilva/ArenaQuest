# Test Suite — `apps/api`

Conventions for this test suite are documented at:

**[`docs/architecture/api/test-conventions.md`](../../../docs/architecture/api/test-conventions.md)**

That doc covers:

- Vitest dual-project split (`workers` vs `node`) and placement rules
- Router vs controller spec convention
- Auth-guard single-source rule (401/403 matrix)
- Migrations helper (`apply-migrations.ts`) — replaces inline DDL

For the underlying Vitest + Cloudflare Workers pool harness, see
[`docs/architecture/api/testing-workers.md`](../../../docs/architecture/api/testing-workers.md).
