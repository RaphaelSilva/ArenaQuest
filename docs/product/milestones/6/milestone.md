# Milestone 6: Auth Self-Service & Social Login

**Status:** Planning
**Scope:** Extends the Auth & Identity domain (Milestone 2) with user-driven password management and a Google OAuth login path. Closes the gap identified after Milestone 5: users cannot recover access without admin intervention, and there is no social login option.

> Note: The original Milestone 6 "Portability Testing & Launch" from `docs/product/specification.md` is renumbered to Milestone 7 to accommodate this feature set.

---

## 1. Objectives

- **Password Recovery:** A user who has forgotten their password can request a secure, time-limited reset link delivered by email and reset their password without admin involvement.
- **Password Update:** An authenticated user can change their current password from a settings screen.
- **Google OAuth Login:** A user can sign in (or register) with their Google account. New OAuth users are auto-provisioned with the `student` role. Existing email-based accounts can be linked to a Google identity.
- **Test Seed Accounts:** Any developer can run a single command to provision three pre-configured local accounts (Admin, Student, Professor) for manual and automated testing.

Out of scope for this milestone:
- Additional OAuth providers (GitHub, Apple, etc.) — provider independence is preserved via the adapter pattern so future providers are a new adapter only.
- Profile avatar sync from Google — deferred to a UX milestone.
- Tutor-initiated password reset on behalf of a student — admin can already do this manually.

---

## 2. Functional Requirements

### 2.1 Password Recovery Flow

1. User submits their email on a "Forgot Password" page.
2. If the email matches an active account, a reset token is generated, hashed, persisted with a 1-hour TTL, and a reset link is sent by email.
3. The response is always identical regardless of whether the email exists (prevents user enumeration).
4. The user follows the link to a "Reset Password" page, submits a new password.
5. The token is consumed (one-time use, atomic). All existing refresh tokens for the user are invalidated, forcing re-login on all devices.
6. The endpoint is rate-limited per IP to prevent abuse.

### 2.2 Password Update Flow

1. An authenticated user navigates to Settings.
2. They submit their current password and a new password.
3. The API verifies the current password before updating.
4. All refresh tokens for the user are invalidated except the calling session.

### 2.3 Google OAuth Flow

1. The login page offers a "Continue with Google" button.
2. Clicking it redirects to the API which initiates a PKCE OAuth 2.0 flow with a `state` nonce stored server-side (KV, 5-minute TTL) to prevent CSRF.
3. Google redirects back to the API callback endpoint.
4. The API validates `state`, exchanges the authorization code for tokens, and reads the user's identity from the Google ID token.
5. **Account resolution:**
   - If a Google identity record exists → authenticate the linked local user.
   - If no Google identity but email matches an active user → link the Google identity to that user and authenticate.
   - Otherwise → create a new active user (role: `student`) and link the Google identity.
6. The API issues ArenaQuest JWT + refresh token and redirects to the web app's OAuth callback page.
7. The web app stores the tokens and redirects to `/dashboard`.

### 2.4 Test Seed Accounts

Three local-only accounts seeded via a dev-only migration:

| Role | Email | Roles Assigned |
|------|-------|----------------|
| Admin | `admin@arenaquest.dev` | `admin` |
| Student | `student@arenaquest.dev` | `student` |
| Professor | `professor@arenaquest.dev` | `tutor`, `content_creator` |

The seed migration must be explicitly excluded from production deployment. A `make db-seed-dev` target runs it locally only.

---

## 3. Acceptance Criteria

- [ ] Submitting an unknown email to `/auth/forgot-password` returns 200 with no error.
- [ ] A valid reset link expires after 1 hour and returns 400 if used after expiry.
- [ ] A reset link can only be used once; a second use returns 400.
- [ ] After a password reset, all previous refresh tokens for that user are rejected.
- [ ] `POST /account/change-password` with the wrong current password returns 400.
- [ ] After a successful password change, other sessions are invalidated.
- [ ] A new user logging in with Google for the first time is provisioned with `status: active` and `role: student`.
- [ ] An existing email-based user logging in with Google sees their existing account and roles preserved.
- [ ] The `state` nonce check prevents a replayed OAuth callback (returns 400 on mismatch/missing nonce).
- [ ] Running `make db-seed-dev` creates all 3 test accounts on a clean local DB.
- [ ] Test credentials are documented in `CONTRIBUTING.md`.
- [ ] `make lint` and `make test` pass after all tasks are merged.
- [ ] No provider-specific imports outside `apps/api/src/adapters/`.

---

## 4. Task Breakdown

| # | Task File | Status |
|---|-----------|--------|
| 01 | [Password Reset Data Layer](./01-password-reset-data-layer.task.md) | ✅ Done |
| 02 | [Forgot Password API](./02-forgot-password-api.task.md) | ✅ Done |
| 03 | [Reset Password API](./03-reset-password-api.task.md) | ✅ Done |
| 04 | [Change Password API (authenticated)](./04-change-password-api.task.md) | 🔲 Pending |
| 05 | [Web: Password Self-Service Pages](./05-web-password-self-service.task.md) | 🔲 Pending |
| 06 | [Google OAuth Data Layer](./06-google-oauth-data-layer.task.md) | 🔲 Pending |
| 07 | [Google OAuth Config & Bindings](./07-google-oauth-config.task.md) | 🔲 Pending |
| 08 | [Google OAuth API Endpoints](./08-google-oauth-api.task.md) | 🔲 Pending |
| 09 | [Web: Google OAuth Login](./09-web-google-oauth.task.md) | 🔲 Pending |
| 10 | [Test Seed Accounts](./10-test-seed-accounts.task.md) | 🔲 Pending |

Dependency graph:

```
01 ──┬── 02 ──┐
     └── 03 ──┤
              ├── 05
04 ───────────┘
06 ──┬── 08 ── 09
07 ──┘
10 (independent)
```

**Recommended execution order:** `01, 06, 07, 10` (parallel) → `02, 03, 04, 08` (parallel) → `05, 09` (parallel).

---

## 5. Definition of Done (milestone level)

- [ ] All 10 tasks marked `✅ Done` with every acceptance box checked.
- [ ] All milestone-level acceptance criteria in §3 pass.
- [ ] `make lint` and `make test` green in CI.
- [ ] Demo walk-through: new user completes Google OAuth login → sees dashboard → changes password from settings → logs out → uses "Forgot Password" to reset → logs back in.
- [ ] Test seed accounts verified: `make db-seed-dev` followed by a login test for all 3 accounts.
- [ ] `docs/product/milestones/6/closeout-analysis.md` authored at milestone close.
- [ ] Agnosticism contract preserved: no provider SDK imports outside `apps/api/src/adapters/`.
