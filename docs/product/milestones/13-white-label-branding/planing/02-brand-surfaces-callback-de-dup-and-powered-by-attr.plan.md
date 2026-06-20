# Plan — Task 02: Brand surfaces, callback de-dup and Powered-by attribution

**Task:** `docs/product/milestones/13-white-label-branding/02-brand-surfaces-callback-de-dup-and-powered-by-attr.task.md`
**Persona:** `frontend-developer` (apps/web only)
**Branch:** `feature/m13/02-...task` (chained — stacked on task 01's HEAD; `brand.ts`, the updated `Logo`, and the `next.config` env are already present)

## Goal

Route the remaining brand surfaces through `brand.ts` (task 01): de-duplicate the
OAuth callback to render `<Logo />`, drive footer copyright + document metadata
from `brand.fullName`, and add a conditional "Powered by ArenaQuest" footer line
gated on `brand.showPoweredBy`.

## Context (verified in the codebase)

- **`brand.ts` (from task 01)** exports `brand` (`fullName`, `showPoweredBy`, …) and a `PLATFORM_NAME = 'ArenaQuest'` constant. Import via the `@web/` alias (e.g. `@web/lib/brand`).
- **Callback** `apps/web/src/app/(auth)/auth/callback/page.tsx` lines 69–72 hold a hand-rolled mark: a `<div>…AQ</div>` badge (34px, `var(--aq-accent)`, text `#0B0E17`) + `<span>Arena<span style={{color:var(--aq-accent)}}>Quest</span></span>` (18px), inside `<div style={{display:'flex',alignItems:'center',gap:10,marginBottom:36}}>`. This is a `'use client'` component.
- **Footer** `apps/web/src/app/page.tsx` line 406: `<span>© {new Date().getFullYear()} ArenaQuest. Todos os direitos reservados.</span>`. This is a **Server Component** with NO existing `useDict`/`dict` import — the whole landing page is hardcoded PT that currently passes `check-i18n-coverage.js` only because strings contain the allowlisted substring "arena".
- **Metadata** `apps/web/src/app/layout.tsx` lines 27–30: `title: "ArenaQuest"`, `description: "ArenaQuest learning platform"` (Server Component).
- **Dicts**: `types.ts` derives `Dictionary` from `dictPt` via `Broaden<>`, so adding keys to both `dict-pt.ts` and `dict-en.ts` needs **no `types.ts` edit**. Top-level namespaces: auth, admin, catalog, dashboard, tasks, enrollment, settings, layout, common, errors. There is **no** `landing` namespace yet.

## Decision (resolved with the user)

The footer's "all rights reserved" trailing sentence is currently hardcoded and
only passes the i18n checker via the "arena" substring. Interpolating
`{brand.fullName}` strips that cover, so the checker would flag the sentence.
**Resolution: keep the sentence as i18n — add it as a dict key** alongside
"Powered by". This task therefore introduces **two** new dict keys (a deliberate
deviation from the task's "single new key" wording, to honor the FR "trailing
sentence still an i18n string" without dropping product copy).

## Steps

1. **New dict namespace `landing.footer`** in BOTH `dict-pt.ts` and `dict-en.ts`, identical key shape:
   - `dict-pt.ts`: `landing: { footer: { rights: 'Todos os direitos reservados.', poweredBy: 'Desenvolvido por' } }`
   - `dict-en.ts`: `landing: { footer: { rights: 'All rights reserved.', poweredBy: 'Powered by' } }`
   - Place the `landing` block consistently in both files (e.g. right after `auth` or before `common` — same position in both). No `types.ts` change (auto-derived).
2. **Footer — `apps/web/src/app/page.tsx`** (Server Component): import `dict` from `@web/i18n` and `brand` + `PLATFORM_NAME` from `@web/lib/brand`.
   - Copyright line → `© {new Date().getFullYear()} {brand.fullName}. {dict.landing.footer.rights}` (the `{...}` interpolations strip clean for the checker; no bare PT/EN literal remains in JSX text).
   - Conditional Powered-by line, rendered only when `brand.showPoweredBy`: e.g. an extra footer element `{brand.showPoweredBy && (<span>{dict.landing.footer.poweredBy} {PLATFORM_NAME}</span>)}`. `PLATFORM_NAME` is interpolated (not a bare "ArenaQuest" literal) so the checker stays green. Keep footer styling/layout intact.
   - Do NOT internationalize the rest of the landing page — out of scope; only the footer area changes.
3. **Metadata — `apps/web/src/app/layout.tsx`**: import `brand` from `@web/lib/brand`; set `title: brand.fullName` and `description: \`${brand.fullName} learning platform\``. Keep it a Server Component (build-time eval). (Object-literal strings are not scanned by the JSX checker.)
4. **Callback de-dup — `apps/web/src/app/(auth)/auth/callback/page.tsx`**: replace the inline badge+wordmark (`<div>…AQ</div>` + `<span>Arena…Quest</span>`) with `<Logo />`. Preserve the surrounding spacing by keeping the wrapper's `marginBottom: 36` — e.g. `<div style={{ marginBottom: 36 }}><Logo /></div>`. Pick the `Logo` `size` closest to the current 34px badge / 18px text (likely `size="lg"`); confirm it renders a visually-equivalent mark for the default brand. Remove the now-unused inline markup. Import `Logo` from `@web/components/design-system`.
5. **Tests.** Add/extend web component tests: (a) callback renders `<Logo />` and contains no inline badge/wordmark markup; (b) footer copyright + document title reflect a custom `brand.fullName`; (c) the Powered-by line shows when `showPoweredBy` is true and is absent when false. Follow existing `apps/web` test patterns (`vi.stubEnv` + module reload for env-driven brand fields, as task 01 did).

## Constraints / guardrails

- Files changed: `(auth)/auth/callback/page.tsx`, `app/page.tsx`, `app/layout.tsx`, `i18n/dict-en.ts`, `i18n/dict-pt.ts`, plus test file(s). No `types.ts` needed (auto-derived) — do not touch it unless the build demands it.
- One mark only: after this task no surface draws the badge/wordmark outside `<Logo>`.
- `"ArenaQuest"` stays the `PLATFORM_NAME` constant (not dictionarised); the only dictionarised copy is `poweredBy` + `rights`.
- Do not convert Server Components to Client. `check-i18n-coverage.js` MUST pass.

## Verification (parent runs)

- `make lint`, `make test-web`, `node apps/web/scripts/check-i18n-coverage.js`
- `grep` callback page → renders `<Logo />`, no inline badge.
- `git diff --stat` — only the files above.
