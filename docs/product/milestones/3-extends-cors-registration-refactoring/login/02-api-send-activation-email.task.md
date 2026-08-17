# Task 02: Activation Email + Activation Endpoint

## Metadata
- **Status:** Done
- **Complexity:** Medium-High
- **Area:** `apps/api`
- **Depends on:** Task 01 (`01-api-public-register-endpoint.task.md`) — needs the `USER_REGISTRATION_CREATED` / `USER_REGISTRATION_DUPLICATE` events and the `INACTIVE` user row.
- **Blocks:** Task 03 (web login page update — needs the success message + activation link UX).

---

## Summary

Task 01 leaves the user inactive and unable to log in. This task closes the loop:

1. When the registration emitter fires, generate a single-use activation token tied to the new user.
2. Send an email containing an activation link of the form `https://<web-host>/activate?token=<opaque>`.
3. Expose `POST /auth/activate` so the frontend can exchange that token for an activation, flipping the user from `INACTIVE` → `ACTIVE`.
4. For the duplicate-registration case, send a different email ("someone tried to register with this address — if it was you, log in or reset your password") so we don't leak account existence over the public API but still help legitimate users.

---

## Technical Constraints

- **Cloud-agnostic mailer port** — define `IMailer` in `packages/shared/ports/i-mailer.ts` with `send({ to, subject, html, text }): Promise<void>`. Implement two adapters in `apps/api/src/adapters/mail/`:
  - `ResendMailAdapter` (default for staging/prod — uses `RESEND_API_KEY` binding). Resend is chosen because it ships from a Worker without any Node runtime dependency.
  - `ConsoleMailAdapter` (used in `local` and tests — writes the rendered email to `console.info` so devs can copy the link from the Wrangler logs).
  - Selection happens in `src/index.ts` based on a new `MAIL_DRIVER` env var (`'console' | 'resend'`).
- **No HTML email frameworks** — keep templates as inline-styled string literals in `src/mail/templates/`. Two templates: `activation-email.ts` and `duplicate-registration-email.ts`. Each exports `{ subject, html, text }` from a `render(input)` function. Inline styles only — no MJML, no React Email.
- **Token storage** — new table `user_activation_tokens(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER NULL, created_at INTEGER NOT NULL)`. Store **only the SHA-256 hash** of the token. The plaintext token is what goes in the email link; once it's used it must be impossible to reuse, even if a DB dump leaks. Mirror the pattern already used in `0004_hash_refresh_tokens.sql`.
- **Token shape** — 32 bytes from `crypto.getRandomValues`, base64url-encoded. TTL 24h. New port `IActivationTokenRepository` in `packages/shared/ports/`.
- **Single-use** — `POST /auth/activate` must atomically check `consumed_at IS NULL AND expires_at > now`, set `consumed_at = now`, and update `users.status = 'active'`. Use a D1 transaction (`db.batch([...])`) so a partial failure can't leave a consumed token with an inactive user.
- **No login on activation** — like Task 01, do not return tokens. Respond `200 { status: 'activated' }`. The frontend redirects to the login screen.
- **Rate limit** `POST /auth/activate` keyed by IP (e.g. `20 / 15 min`) to mitigate token-guessing. The 32-byte token space makes guessing impractical, but the limit cheaply removes the attack surface.
- **Activation link host** — read from a new `WEB_BASE_URL` env var (e.g. `http://localhost:3000` in dev, the Pages URL in staging/prod). Never hardcode.
- **Idempotency for duplicate-registration emails** — at most one duplicate notice per email per 24h, tracked in KV with TTL. Otherwise an attacker scraping addresses could spam a victim's inbox.

---

## Scope

### Endpoint

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/activate` | none | Consume an activation token, flip the user to `ACTIVE` |

### Request / Response Contracts

**POST /auth/activate**

Request body:
```jsonc
{ "token": "<base64url, 32 bytes>" }
```

Responses:
- `200 { "status": "activated" }` — token was valid, unused, not expired; user is now `active`.
- `200 { "status": "already_active" }` — token already consumed AND user is already `active` (idempotent retry, e.g. user clicked the link twice).
- `400 { "error": "InvalidToken" }` — token absent, malformed, expired, or unknown. Do **not** distinguish between expired and unknown tokens (no oracle).
- `429 TooManyRequests` — rate limit.

### Files to add / change

- **Migration** `apps/api/migrations/0007_create_activation_tokens.sql`:
  ```sql
  CREATE TABLE user_activation_tokens (
    token_hash    TEXT    PRIMARY KEY,
    user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at    INTEGER NOT NULL,
    consumed_at   INTEGER NULL,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX idx_activation_tokens_user ON user_activation_tokens(user_id);
  ```
- **New port** `packages/shared/ports/i-mailer.ts`.
- **New port** `packages/shared/ports/i-activation-token-repository.ts` (`create`, `consumeByPlainToken`, `purgeExpired`).
- **New** `apps/api/src/adapters/db/d1-activation-token-repository.ts`.
- **New** `apps/api/src/adapters/mail/console-mail-adapter.ts`.
- **New** `apps/api/src/adapters/mail/resend-mail-adapter.ts`.
- **New** `apps/api/src/mail/templates/activation-email.ts` and `duplicate-registration-email.ts`.
- **New** `apps/api/src/core/registration/registration-mail-handler.ts`:
  - Subscribes to the registration emitter from Task 01.
  - On `USER_REGISTRATION_CREATED`: generates a token, persists hash, renders + sends activation email.
  - On `USER_REGISTRATION_DUPLICATE`: checks the per-email KV idempotency key, sends the duplicate-registration notice, sets the KV key with 24h TTL.
- **New** `apps/api/src/controllers/activate.controller.ts` — exposes `activate({ token })` returning `ControllerResult`.
- **New** `apps/api/src/routes/activate.router.ts` — Hono sub-router mounting `POST /activate`, attached under `/auth`.
- **Update** `apps/api/src/index.ts` — construct mailer + token repo + handler, subscribe handler to emitter.
- **Update** `apps/api/wrangler.jsonc` — add `RESEND_API_KEY` (secret), `MAIL_DRIVER`, `WEB_BASE_URL`, and a KV namespace for the duplicate-registration idempotency keys (or reuse `RATE_LIMIT_KV` with a `dup-reg:` prefix).

### Email templates — required content
Each template, in Portuguese (matching the existing UI copy):

**Activation email**
- Subject: `Ative sua conta no ArenaQuest`
- Body: greet by user `name`; one-paragraph explanation; primary CTA button → `${WEB_BASE_URL}/activate?token=${plainToken}`; plain-text fallback URL; mention the link expires in 24h; footer with "se você não criou esta conta, ignore este e-mail".

**Duplicate-registration email**
- Subject: `Tentativa de cadastro com seu e-mail`
- Body: greet by user `name`; explain that someone tried to register with this address; CTA → `${WEB_BASE_URL}/login`; suggest "Esqueci a senha" if it wasn't them; **no activation link, no token**.

---

## Acceptance Criteria

- [x] After `POST /auth/register` (Task 01) succeeds for a fresh email, exactly one activation email is sent to that address with a working link of shape `${WEB_BASE_URL}/activate?token=...`.
- [x] After `POST /auth/register` for an email already in `users`, the duplicate-registration email is sent (no activation link), but only **once per 24h** for the same address.
- [x] `POST /auth/activate` with a valid, unconsumed, unexpired token sets `users.status = 'active'`, marks the token consumed, and returns `200 { status: 'activated' }`.
- [x] `POST /auth/activate` with the same token a second time returns `200 { status: 'already_active' }` and does not write to `users` again.
- [x] `POST /auth/activate` with a missing/expired/unknown/malformed token returns `400 InvalidToken` with no ability to distinguish expired-vs-unknown.
- [x] After successful activation, `POST /auth/login` with the user's credentials returns `200` with `accessToken` (regression — confirms the `INACTIVE` block is gone).
- [x] The activation-token table stores only **hashes** of tokens; selecting the table never reveals plaintext.
- [x] `MAIL_DRIVER=console` writes the activation link to stdout in dev so engineers can complete the flow without an SMTP setup.

---

## Test Plan

### Unit tests
1. **`registration-mail-handler.spec.ts`**
   - `USER_REGISTRATION_CREATED` event → token repo `create` called once, mailer called with `to = user.email`, html contains `${WEB_BASE_URL}/activate?token=`.
   - `USER_REGISTRATION_DUPLICATE` event, idempotency key absent → duplicate email sent, KV key set with 24h TTL.
   - `USER_REGISTRATION_DUPLICATE` event, idempotency key present → mailer **not** called.
   - Mailer throws → handler logs but does not rethrow (registration must not roll back because email failed).
2. **`activate.controller.spec.ts`**
   - Valid token → user repo `update(id, { status: ACTIVE })` called, token repo `consumeByPlainToken` called, result `{ status: 'activated' }`.
   - Same token consumed twice → second call returns `{ status: 'already_active' }`, user repo `update` **not** called the second time.
   - Expired token → `400 InvalidToken`.
   - Unknown token → `400 InvalidToken` with the **same** error string and shape as the expired case (no oracle).
   - Empty / non-string body → `400 BadRequest` (or `400 InvalidToken` — pick one and document; do not 500).
3. **`d1-activation-token-repository.spec.ts`**
   - `create` stores the SHA-256 hash, not the plaintext.
   - `consumeByPlainToken` is atomic: a concurrent second consume sees `consumed_at` already set and refuses.

### Integration tests — `apps/api/test/routes/activate.router.spec.ts`
1. **Full flow** — register → capture token from the test mailer → `POST /auth/activate` → `POST /auth/login` succeeds with a 200 + accessToken.
2. **Duplicate-registration flow** — pre-seed an active user; register again with the same email; assert duplicate email was sent (test mailer captured it) and there is **no** activation token in the DB for that registration call.
3. **Stale token** — manually set `expires_at` in the past; `POST /auth/activate` returns `400 InvalidToken`.
4. **Replay** — call `POST /auth/activate` twice; second call returns `200 already_active`.
5. **Rate limit** — 21 attempts in 15min from one IP → 21st returns `429`.

### Manual verification
1. `make dev-api` and `make dev-web`.
2. `wrangler d1 migrations apply arenaquest-dev --local` to apply `0007_create_activation_tokens.sql`.
3. Set `MAIL_DRIVER=console` in `.dev.vars`.
4. Register a fresh user via the web UI (or curl).
5. Copy the activation link from the Wrangler stdout.
6. `curl -X POST http://localhost:8787/auth/activate -H 'content-type: application/json' -d "{\"token\":\"<paste>\"}"` → expect `200 { "status": "activated" }`.
7. Log in with the same credentials → success.
8. Re-run the activate call → expect `200 { "status": "already_active" }`.
9. Wait or manually expire a token, retry → expect `400 InvalidToken`.

### Definition of Done
- [x] Unit + integration tests green (`make test-api`).
- [x] Migration `0007_create_activation_tokens.sql` runs cleanly against a fresh local D1.
- [x] `MAIL_DRIVER=console` and `MAIL_DRIVER=resend` both wire successfully (Resend exercised manually against a sandbox key, not in CI).
- [x] No plaintext tokens in any persistent store (DB, KV, logs sent to production telemetry).
- [x] `IMailer` and `IActivationTokenRepository` ports live in `packages/shared/ports` (cloud-agnostic) — no Cloudflare types in their signatures.
