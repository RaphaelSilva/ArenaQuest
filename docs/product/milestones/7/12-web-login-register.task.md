# Task 12 — Web: Login & Register Redesign

**Status:** 🚧 In Progress
**Milestone:** [7](./milestone.md)

## Summary

Replace the current Login and Register pages with the wireframe in `docs/product/web/wire/Login.html`: a hero side panel with brand + value props, a tabs panel for Entrar / Criar conta, a 2-step register flow (account → role + terms), live password strength meter, and a post-register state that points the user to the activation e-mail.

## Current State (2026-05-12)

The redesign is largely implemented in `apps/web/src/app/(auth)/login/page.tsx`, which today contains the hero panel, tabs, both forms, the 2-step register stepper, the password strength meter, the role selector, and the registration-pending screen. Remaining work is structural (component extraction) and responsive (mobile breakpoint), plus minor cleanup (unused phone field).

## Dependencies

None on the backend (reuses M6 APIs as-is). Independent of all other M7 tasks.

## Technical Constraints

- Next.js 15 App Router under `apps/web/src/app/(auth)/`. Tailwind v4 styling; theme tokens reuse the existing design system. No new external CSS.
- Google OAuth button calls the existing M6 OAuth start endpoint; no behaviour change.
- The `(auth)` group must not import from `(protected)` routes.
- The hero panel must collapse to a single-column layout under 768 px width.

## Scope

In:
- Extract shared components from `login/page.tsx`: `HeroPanel`, `AuthTabs`, `PasswordStrength`, `RoleSelect`, `RegisterSuccess` (currently inline).
- Add responsive layout: hero panel collapses to single column under 768 px.
- Remove the unused `telefone` input from the register step 1 form (not persisted by the API).

Out:
- Backend changes (none needed).
- Profile photo upload (deferred).
- Splitting into a dedicated `/register` route — current single-page tabbed UX is the chosen pattern.
- Migration to `react-hook-form` + `zod` — current manual validation already covers the required cases; revisit only if validation complexity grows.
- Auto-login post-register / redirect to `/dashboard` — incompatible with the M6 e-mail activation flow; the post-register state correctly directs the user to check their inbox.

## Acceptance Criteria

- [x] Both pages render at desktop (≥ 1280 px) within ±8 px of the wireframe layout.
- [x] Submitting the login form with invalid credentials surfaces the API error inline without leaving the page.
- [x] Register step 1 cannot proceed unless required fields validate; step 2 cannot submit until terms checkbox is checked.
- [x] Password strength meter colours and labels match the wireframe.
- [x] Google OAuth button still completes the M6 OAuth flow successfully on staging.
- [x] Post-register success screen instructs the user to confirm their e-mail and offers a path back to login (replaces the original `/dashboard` redirect to align with the M6 activation flow).
- [ ] Hero panel collapses to a single-column layout under 768 px.
- [ ] Shared components (`HeroPanel`, `AuthTabs`, `PasswordStrength`, `RoleSelect`, `RegisterSuccess`) extracted from `login/page.tsx` into reusable modules.
- [ ] Unused `telefone` field removed from the register form.
- [ ] `make lint` passes; component-level RTL test covers step navigation.

## Verification Plan

1. Run `make dev-web` and walk both flows in light + dark themes at desktop and mobile widths.
2. RTL spec for the register stepper and password meter.
3. `make lint`.
