# Plan — 12-web-login-register

**Task:** [12-web-login-register.task.md](../12-web-login-register.task.md)
**Milestone:** 7
**Assigned personas:** frontend-developer
**Branch:** feature/m7/12-web-login-register.task (from feature/m7/candidate)

## Objective

The login page already implements the full redesign (hero panel, tabs, 2-step register, password meter, role selector, post-register success screen). The remaining work is: (1) extract the five inline components into separate files under `apps/web/src/components/auth/`, (2) make the hero panel collapse to a single-column layout on screens narrower than 768 px, and (3) strip the unused `telefone` field from step 1 of the register form.

## Affected areas

- `apps/web/src/app/(auth)/login/page.tsx` — primary file to refactor
- `apps/web/src/components/auth/hero-panel.tsx` — new component (extracted)
- `apps/web/src/components/auth/auth-tabs.tsx` — new component (extracted)
- `apps/web/src/components/auth/password-strength.tsx` — new component (extracted)
- `apps/web/src/components/auth/role-select.tsx` — new component (extracted)
- `apps/web/src/components/auth/register-success.tsx` — new component (extracted)
- `apps/web/src/app/(auth)/login/__tests__/login.spec.tsx` — RTL test for step navigation and password meter

Out of scope:
- Backend changes
- `/register` route split
- `react-hook-form` migration
- Auto-login post-register

## Step-by-step

### Frontend

1. **Extract `HeroPanel`** — The left panel (brand logo, headline, 3 feature bullets). Props: `none` (no dynamic data). File: `components/auth/hero-panel.tsx`.

2. **Extract `PasswordStrength`** — The 4-segment bar + label shown while typing a password. Props: `{ password: string }`. File: `components/auth/password-strength.tsx`. Keep `getStrength`, `STRENGTH_COLORS`, `STRENGTH_LABELS` inside this file.

3. **Extract `RoleSelect`** — The 2-card role picker (Participante / Instrutor) + description box. Props: `{ value: 'participant' | 'instructor'; onChange: (v: 'participant' | 'instructor') => void }`. File: `components/auth/role-select.tsx`.

4. **Extract `RegisterSuccess`** — The `RegistrationPendingState` component (email icon + instructions + back-to-login button). Props: `{ email: string; onBackToLogin: () => void }`. File: `components/auth/register-success.tsx`.

5. **Extract `AuthTabs`** — The `Entrar / Criar conta` segmented control. Props: `{ mode: 'login' | 'register'; onChange: (m: 'login' | 'register') => void }`. File: `components/auth/auth-tabs.tsx`.

6. **Responsive layout** — In `LoginPageInner`, replace the fixed `minWidth: 480` on the right panel and the `maxWidth: 520` on the left panel with responsive behavior. Add a CSS class (via `<style jsx>` or a `<style>` tag in the component) or use Tailwind's `md:` prefix. The hero panel (`HeroPanel` inside the left div) should be `display: none` on `< 768px` and `display: flex` on `>= 768px`. The right panel should become `width: 100%` below 768 px. Use `@media (max-width: 767px)` in an inline `<style>` block (since this file is already heavily inline-styled and has no Tailwind classes on layout divs).

7. **Remove `telefone` field** — In `RegisterForm` (step 1), delete the phone state (`const [phone, setPhone] = useState('');`), the `PhoneIcon` SVG component, and the entire phone input block. Since `phone` was never sent to the API, no backend change is needed.

8. **Update imports in `login/page.tsx`** — Replace the inlined implementations with imports from the new component files.

9. **Write RTL test** — `apps/web/src/app/(auth)/login/__tests__/login.spec.tsx`: test that (a) step navigation works (fill step 1 fields → click Continuar → step 2 appears), and (b) `PasswordStrength` renders the correct label for a given password strength.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| Hero panel collapses to single column under 768 px | Step 6 | frontend | Resize browser / DevTools to 767px — left panel hidden, right panel full-width |
| Shared components extracted | Steps 1–5, 8 | frontend | Files exist, page.tsx imports them, no inline duplication |
| Unused `telefone` field removed | Step 7 | frontend | Field absent in rendered form; `phone` state and PhoneIcon gone |
| `make lint` passes; RTL test covers step navigation | Step 9 | frontend | `make lint && make test-web` green |

## Risks & open questions

- The page uses inline styles throughout; Tailwind media queries won't fire unless the divs have Tailwind classes. Use a `<style>` tag with a named CSS class for the responsive breakpoint rather than fighting the inline-style paradigm.
- `PhoneIcon` is only used by the telefone field — safe to delete entirely after that field is removed.

## Verification

- Frontend: `make lint && make test-web` + visual check in browser at desktop (≥1280px) and mobile (≤767px) widths.
- Manual: shrink DevTools to 400px — hero panel disappears, form fills full width.

## Out of scope

- Backend changes
- Profile photo upload
- `/register` route
- `react-hook-form` / `zod` migration
- Auto-login post-register
