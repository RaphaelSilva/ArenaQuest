# Plan — Task 04: Migrate `(auth)` route group strings to the dictionary

Detailed technical plan to migrate all strings in `(auth)` route group to typed dictionaries.

## Proposed Changes

### [Component] (auth) Route Group i18n Migration

#### [MODIFY] [login/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(auth)/login/page.tsx)
* Replace all hardcoded strings (Welcome back, Sign in, placeholders, buttons, links, error state labels) with reads from `dict` (since it is a Server Component) or `useDict()`.

#### [MODIFY] [activate/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(auth)/activate/page.tsx)
* Replace all hardcoded strings with dictionary reads.

#### [MODIFY] [forgot-password/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(auth)/forgot-password/page.tsx)
* Replace all hardcoded strings with dictionary reads.

#### [MODIFY] [reset-password/page.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/(auth)/reset-password/page.tsx)
* Replace all hardcoded strings with dictionary reads.

#### [MODIFY] [auth-tabs.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/auth/auth-tabs.tsx)
* Replace tabs text with `useDict()` read.

#### [MODIFY] [hero-panel.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/auth/hero-panel.tsx)
* Replace marketing and feature list strings with `dict` / `useDict()` reads.

#### [MODIFY] [__tests__ files](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/components/auth/__tests__)
* Update tests asserting on hardcoded text strings to read assertions dynamically from `dictPt` / `dictEn` to guarantee correctness under translation.

## Verification Plan

### Automated Tests
- Run `tsc --noEmit`, `make lint-web` and `make test-web` to ensure strict TS and no errors.
