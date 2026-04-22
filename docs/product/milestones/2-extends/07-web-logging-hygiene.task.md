# Task 07: Web Logging Hygiene (remove `console.log`, add lint rule)

## Metadata
- **Status:** Done — commit `1acf836`
- **Complexity:** Low
- **Severity closed:** S-07 (Low)
- **Story:** [`auth-hardening.story.md`](./auth-hardening.story.md)
- **Dependencies:** none

---

## Summary

Remove the leftover `console.log('API_URL', API_URL)` in the browser auth client and add
a lint rule to prevent regressions. `console.warn` / `console.error` remain allowed for
intentional diagnostics.

---

## Technical Constraints

- **Lint-only guard is enough:** a build-time failure gate would be heavy-handed. `warn`
  level keeps PRs moving but surfaces the issue in CI logs.
- **Scope:** `apps/web/src/**/*.{ts,tsx}` only; `apps/web/__tests__/**` may keep
  `console.log` (test-only diagnostics).
- **No new package:** `no-console` is built into `eslint`.

---

## Scope

### 1. Remove the line

`apps/web/src/lib/auth-api.ts:12` — delete the `console.log`.

### 2. ESLint rule

Add to `apps/web/eslint.config.mjs`:

```js
{
  files: ['src/**/*.{ts,tsx}'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
},
```

### 3. Audit

`grep -R "console.log" apps/web/src` → should be empty. If hits appear, decide per-case
(delete, convert to `console.warn`, or add a targeted `eslint-disable-next-line`).

---

## Acceptance Criteria

- [x] `apps/web/src/lib/auth-api.ts` no longer contains `console.log`.
- [x] `apps/web/eslint.config.mjs` has the `no-console` rule scoped to `src/**`.
- [x] `make lint` reports no new warnings in `apps/web`.
- [x] `grep -R "console.log" apps/web/src` returns no matches.

---

## Verification Plan

1. `make lint` — clean.
2. Introduce a deliberate `console.log('x')` in any `apps/web/src` file, re-run lint →
   it warns. Revert.
