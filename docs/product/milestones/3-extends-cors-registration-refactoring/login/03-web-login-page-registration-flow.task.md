# Task 03: Wire the Login Page to the Real Registration + Activation Flow

## Metadata
- **Status:** Done
- **Complexity:** Medium
- **Area:** `apps/web`
- **Depends on:** Task 01 (`POST /auth/register`), Task 02 (`POST /auth/activate` + activation email).
- **File touched:** `apps/web/src/app/(auth)/login/page.tsx` and a new `app/activate/page.tsx`.

---

## Summary

The login page already has a beautifully designed `RegisterForm` component, but its `handleSubmit` is currently a `setTimeout(...) → onSuccess()` placeholder. This task replaces the placeholder with real calls to the new endpoints and rewires the success state to reflect the activation flow:

- After successful registration, the UI must show **"Check your email — we sent you an activation link"** instead of the current "Arena unlocked!" auto-redirect-to-dashboard.
- A new `/activate` route handles the link click: it reads `?token=...`, calls `POST /auth/activate`, and routes the user to `/login` with a flash banner once activation succeeds.
- `LoginForm`'s error mapping should also handle the `INACTIVE` case so an unactivated user sees "Confira seu e-mail para ativar sua conta" instead of "E-mail ou senha inválidos."

---

## Technical Constraints

- **No new HTTP client** — extend `apps/web/src/lib/auth-api.ts` with `register({ name, email, password })` and `activate({ token })`. Use the same `fetch` + `NEXT_PUBLIC_API_URL` pattern that `login`/`logout`/`refresh` already use.
- **No silent auto-login after registration** — even if the API returned tokens, we would not store them. The user must activate first. Today's `RegisterForm` calls `onSuccess()` which transitions to a `SuccessState` that auto-redirects to `/dashboard`. That redirect must be removed.
- **Don't leak duplicate-email enumeration on the client either** — the API returns `202 { status: 'pending_activation' }` whether the email is fresh or duplicate. The UI must show the **same** success copy in both cases. Do not surface "this email already exists."
- **Preserve the existing visual design** — colors, fonts, animations, and the two-step register flow are already shipped (commit `b1a8ff4`). This task is logic-only; no design changes. Reuse the existing `s` style object and existing icon components.
- **Activation page is a separate route** — `app/activate/page.tsx` (NOT under `(auth)` layout if the existing `(auth)/layout.tsx` redirects already-authenticated users away — verify, since an activating user is by definition unauthenticated). Render a minimal full-screen state: spinner while pending, success message + "Ir para login" button, or the same error copy for invalid/expired tokens.
- **Error copy in Portuguese** — match the existing UI language. Include the strings in the spec below so QA can match them verbatim.
- **Form-level error mapping** — `RegisterForm` should display field-level errors when the API returns `400 { error: 'ValidationFailed', fields: [...] }`. Map field names back onto the existing `RegisterErrors` shape.

---

## Scope

### File: `apps/web/src/lib/auth-api.ts`
Add:
```ts
export async function register(input: { name: string; email: string; password: string }): Promise<{ status: 'pending_activation' }> { /* ... */ }
export async function activate(input: { token: string }): Promise<{ status: 'activated' | 'already_active' }> { /* ... */ }
```
Both throw a typed error class (reuse / extend whatever `login` throws today) with `code: 'ValidationFailed' | 'InvalidToken' | 'NetworkError' | 'RateLimited'` so the UI can branch.

### File: `apps/web/src/app/(auth)/login/page.tsx`

1. **`RegisterForm.handleSubmit`** — replace the `setTimeout` with:
   ```ts
   try {
     await register({
       name: `${firstName.trim()} ${lastName.trim()}`.trim(),
       email: email.trim().toLowerCase(),
       password: pw,
     });
     onSuccess();             // transitions to the new "check your email" state
   } catch (err) {
     if (err.code === 'ValidationFailed') setErrors(mapApiErrorsToFields(err.fields));
     else if (err.code === 'RateLimited') setErrors({ terms: 'Muitas tentativas. Tente novamente em alguns minutos.' });
     else setErrors({ terms: 'Não foi possível concluir o cadastro. Tente novamente.' });
   } finally {
     setLoading(false);
   }
   ```
   `mapApiErrorsToFields` lives near the form; map server `field: 'name' | 'email' | 'password'` → local `RegisterErrors` keys.

2. **Replace `SuccessState`** with `RegistrationPendingState`:
   - Headline (PT): **"Confira seu e-mail"**
   - Body: **"Enviamos um link de ativação para <strong>{email}</strong>. Clique no link para ativar sua conta e entrar na Arena."**
   - Secondary line: **"Não recebeu? Verifique a caixa de spam. O link expira em 24 horas."**
   - Primary button → switches `mode` back to `'login'` (no auto-redirect, no `setTimeout` to `/dashboard`).
   - Pass the email down via the `onSuccess` callback (`onSuccess(email: string)`) so the screen can interpolate it.

3. **`LoginForm` error branch** — currently `catch { setError('E-mail ou senha inválidos.') }`. The API returns `401 InvalidCredentials` for both wrong-password AND inactive-account. Extend `auth-api.login` (if not already) to expose a sub-code like `'AccountInactive'` when the API surfaces `ACCOUNT_INACTIVE`, OR add a separate `GET /auth/account-status?email=...` is **NOT** acceptable (enumeration leak).
   - Pragmatic minimum for this task: keep the generic message, but if `localStorage.getItem('aq_pending_activation_email') === email` (set on registration success), show **"Confira seu e-mail para ativar sua conta antes de entrar."** instead. Clear the key on a successful login.

### New file: `apps/web/src/app/activate/page.tsx`
- Client component using `useSearchParams()` to read `?token=`.
- States: `pending` (calling API), `success` (status `activated` or `already_active`), `error` (any other case).
- On `success`: button "Ir para login" → `router.push('/login?activated=1')`.
- On `error`: copy **"Link inválido ou expirado. Solicite um novo cadastro ou contate o suporte."** + "Voltar ao login" button.
- Reuse the same background and brand block from the login page (lift the geometry into a shared component if doing so is trivial; otherwise inline).

### `LoginPage` flash banner
- When `useSearchParams().get('activated') === '1'`, render a green banner above the tab switcher: **"Conta ativada! Faça login para continuar."** Banner dismisses on form submit or after 6s.

### File-level test wiring
- Update / extend `apps/web/__tests__/app/(auth)/login.test.tsx` (already open in the IDE) with the new flow.
- Add `apps/web/__tests__/app/activate.test.tsx`.

---

## Acceptance Criteria

- [x] `RegisterForm` submits to `POST /auth/register` and shows the new "Confira seu e-mail" state on `202`.
- [x] On `400 ValidationFailed`, field errors render inline next to the offending input — no generic toast.
- [x] No auto-redirect to `/dashboard` after registration. The user must explicitly navigate via the activation link or the "Voltar ao login" button.
- [x] `/activate?token=<valid>` flips the user to active and lands on `/login?activated=1` with the green banner visible.
- [x] `/activate?token=<invalid|missing|expired>` shows the error state and never throws an uncaught promise rejection.
- [x] An unactivated user attempting to log in sees the activation reminder copy iff the registration just happened in this browser (the local-storage key is set); otherwise the generic invalid-credentials copy still shows (no enumeration leak).
- [x] No regressions in the existing Login flow for already-active users.

---

## Test Plan

### Unit / component tests — `apps/web/__tests__/app/(auth)/login.test.tsx`
1. **Register happy path** — fill the two-step form, submit; mock `register()` resolves; assert the page now shows the email in the "Confira seu e-mail" copy and the dashboard auto-redirect did **not** fire (use fake timers + assert `router.replace` was not called).
2. **Register validation error** — mock `register()` rejects with `code: 'ValidationFailed', fields: [{ field: 'password', code: 'TooShort' }]`. Assert the password field shows an inline error with the proper Portuguese message and submit button is re-enabled.
3. **Register rate limited** — mock `register()` rejects with `code: 'RateLimited'`. Assert the rate-limit banner is rendered.
4. **Login while inactive (with the localStorage hint)** — set `localStorage.setItem('aq_pending_activation_email', 'a@b.com')`, submit login with that same email; mock `login()` rejects with 401; assert the page shows "Confira seu e-mail para ativar sua conta antes de entrar.".
5. **Login while inactive (no hint)** — same as above but without the localStorage key; assert the generic "E-mail ou senha inválidos." message.
6. **Activated banner** — render the page with `?activated=1`; assert the green banner is visible; submit any login → banner disappears.
7. **Tab switching** — switching from register to login and back resets transient errors but preserves the email field (existing behavior — regression check).

### New file — `apps/web/__tests__/app/activate.test.tsx`
1. **Token absent** — render `/activate` with no `token` query → error state, button "Voltar ao login" routes to `/login`.
2. **Token valid** — mock `activate()` resolves `{ status: 'activated' }` → success state; click "Ir para login" → `router.push('/login?activated=1')`.
3. **Token already used** — mock returns `{ status: 'already_active' }` → success state with the same copy (idempotency).
4. **Token invalid** — mock rejects with `code: 'InvalidToken'` → error state with the expected Portuguese copy.
5. **Network error** — mock rejects with `code: 'NetworkError'` → error state, but with a "Tentar novamente" button that re-fires the call.

### Manual verification (must do before marking DoD)
1. `make dev` (web on `:3000`, api on `:8787`, `MAIL_DRIVER=console`).
2. Open `http://localhost:3000/login`, switch to **Criar conta**, fill the form with a fresh email + valid password, submit.
3. Confirm the right panel shows the "Confira seu e-mail" state with your email rendered. Confirm there is **no** auto-redirect to `/dashboard`.
4. Copy the activation link from Wrangler's stdout, paste into a new browser tab.
5. Confirm `/activate` shows a brief spinner then the success state. Click "Ir para login".
6. Confirm `/login?activated=1` shows the green "Conta ativada!" banner.
7. Log in with the same credentials → land on `/dashboard`.
8. Open a private window. Try to register again with the same email. Confirm the success copy is identical (no enumeration leak). Confirm the duplicate-registration email arrives in Wrangler stdout (Task 02 behavior — sanity check, not strictly this task's surface).
9. Try `/activate?token=garbage` — confirm error state.
10. Try logging in with a freshly registered (not yet activated) account in the same browser — confirm the activation reminder copy from AC #6.
11. Run an axe / Lighthouse pass on the new `/activate` page; no new accessibility regressions vs. the login page baseline.

### Definition of Done
- [x] All component tests pass (`pnpm --filter web test`).
- [x] Type checks clean (`pnpm turbo run build`).
- [x] Lint clean (`make lint`).
- [x] No `setTimeout`-based fake-success branches remain in `RegisterForm`.
- [x] `apps/web/src/lib/auth-api.ts` exports `register` and `activate`, both covered by at least one test.
- [x] Manual flow #1–#11 above all pass on a fresh local DB.
