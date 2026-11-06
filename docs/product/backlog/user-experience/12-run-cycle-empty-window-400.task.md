# Task 12 — Frontend: Run the billing cycle with an empty window posts no body and fails with 400

**Status:** ✅ Done
**Kind:** Bug
**Team:** Frontend Web
**Priority:** High
**Found in:** Milestone 19 closeout browser verification, 2026-11-06

## Summary

On `/admin/billing` → **Lançamentos** → **Rodar o ciclo**, an administrator who leaves
both window dates empty — the default, and the only path the screen's own copy
recommends ("the server applies its own defaults") — gets *"A execução do ciclo de
cobrança falhou"* every time. The run never reaches the billing service: the request
is rejected at the HTTP layer with `400 Malformed JSON in request body`. The same
control works when either date is filled, and the same endpoint answers `200` to
`POST /v1/admin/billing/invoices/run` with a `{}` body over `curl`. Blocked flow for
the admin role, on every device and environment; reproducible locally with the seed.
No data is lost or corrupted — nothing is written — but the manual twin of the daily
cron (RFC 0013 §6, M19 Task 13) is unusable from the product on its default path.

## Reproduction

1. Local replica after `make setup` (`admin@arenaquest.dev`), `make dev-api` and
   `make dev-web`; any contract state — the request fails before the service runs.
2. Log in as the admin, open `/admin/billing`, select the **Lançamentos** tab, activate
   **Rodar o ciclo de cobrança agora**, leave **Desde** and **Na data de** empty, and
   activate **Rodar o ciclo agora**.
3. **Expected:** the run executes with the server's defaults (`asOf` = today, `since` =
   the day before) and the report renders (issued / absorbed / reminders / crossings).
4. **Actual:** the panel shows *"A execução do ciclo de cobrança falhou. Nenhum
   relatório é exibido, porque a execução não foi concluída…"*. Captured in the
   browser: `POST http://localhost:8787/v1/admin/billing/invoices/run` with request
   header `content-type: application/json` and `postData: null`; response
   `400` with body `Malformed JSON in request body`. The Worker log reads
   `POST /v1/admin/billing/invoices/run 400 Bad Request`. Filling the window
   (`since=2026-11-05`, `asOf=2026-11-06`) on the same screen yields `200` and the
   report; `curl -X POST … -H 'content-type: application/json' -d '{}'` also yields
   `200`.

## Root Cause

**Established** (read in the code on 2026-11-06, and measured as above):

- `apps/web/src/app/(protected)/admin/billing/run-cycle-panel.tsx` (`run()`) builds the
  window and deliberately passes `undefined` when it is empty — "An empty window posts
  no body at all, so the server applies its own defaults".
- `apps/web/src/lib/admin-billing-api.ts` (`invoices.run(input?)` → `send()`) honours
  that: `input === undefined ? undefined : { body: JSON.stringify(input) }`, so no body
  is attached. The client test *"posts to the run endpoint with no body at all when no
  window is given"* (`apps/web/src/lib/__tests__/admin-billing-api.test.ts`) pins this.
- `apps/web/src/lib/api-client.ts` (`http()`) sets `Content-Type: application/json` on
  every request, body or not.
- The route (`apps/api/src/routes/admin/billing.ts`, `runInvoiceCycleRoute`) declares
  the body as `required: false` with an `application/json` schema. With the JSON
  content type present on the request, `@hono/zod-openapi`'s validator parses the
  (empty) body and fails with `Malformed JSON in request body` before the optional
  schema is consulted. "No body" and "a JSON body" are therefore not interchangeable
  for this route: an empty window must be sent as `{}`.

**Not established:** nothing. The cause is fully read and measured; no other
`send()` caller posts `undefined` on purpose, so the fix is local to this route.

## Scope

In:
- Send `{}` for an empty window, so the server applies its defaults as the panel's
  copy already promises, and keep the half-window and full-window bodies unchanged.
- Flip the client test that pinned "no body at all" to pin `{}` instead, and add a
  panel-level regression that an empty window reaches the client as `{}` (or as a
  call whose request carries a JSON body), failing on the old code.

Out:
- Changing `api-client.ts`'s content-type behaviour for every request, or the API's
  body handling — a wider change than the reproduced path needs.
- Any other billing screen; nothing else posts an optional body.

## Technical Constraints

- **Scope guardrail:** changes restricted to:
  - `apps/web/src/lib/admin-billing-api.ts`
  - `apps/web/src/lib/__tests__/admin-billing-api.test.ts`
  - `apps/web/src/app/(protected)/admin/billing/run-cycle-panel.tsx` (the comment and,
    if the panel keeps passing `undefined`, nothing else)
  - `apps/web/src/app/(protected)/admin/billing/__tests__/run-cycle-panel.test.tsx`
- The fix must not change behaviour outside the reproduced path: a supplied window
  (one or both dates) is still posted exactly as typed, and no other `send()` call
  changes.
- No API change: the route already accepts `{}` and applies its defaults.

## Acceptance Criteria

- [x] The reproduction above no longer reproduces: with both dates empty the request
      carries the body `{}` under `Content-Type: application/json`, the API answers
      `200`, and the report renders on the panel.
- [x] A regression test pins the fixed behaviour (it fails on the old code): the client
      posts `{}` when `run()` is called with no window, and the panel's empty-window
      submit produces a request with a JSON body.
- [x] The half-window and full-window client tests still pass unchanged.
- [x] `make test-web` and `make lint` green.
- [x] No diff outside the scope guardrail.

## Verification Plan

1. Run the reproduction steps on the old code and confirm the `400` in the Worker log
   and the failure copy on the panel.
2. Apply the fix; run the reproduction again (empty window → `200` + report), then
   `make test-web` and `make lint`.
3. `git diff --stat` confirms only scope-guardrail files changed.

## Resolution (2026-11-06)

- Fix: `admin-billing-api.ts#invoices.run` posts `input ?? {}`; the panel still passes
  `undefined` for an empty window (comment updated).
- Tests flipped: the client test and the panel test that pinned "no body at all" now pin
  `{ body: '{}' }`; both failed on the old code and pass on the fix. Targeted run: 44
  passed. Full `make test-web` green; `make lint` exit 0.
- Browser re-check (headless Chromium 151, local replica): empty window → request body
  `"{}"` under `Content-Type: application/json`, response `200` (2 eligible, 2 absorbed),
  report rendered, no failure copy.
- `git diff --stat`: the four guardrail files only.
