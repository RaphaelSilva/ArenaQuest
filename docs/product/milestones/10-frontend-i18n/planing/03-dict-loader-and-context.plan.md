# Plan — Task 03: Server dict loader and client `DictProvider` / `useDict`

Detailed technical plan to implement the server loader and the React client context.

## Proposed Changes

### [Component] i18n Loader & Context

#### [NEW] [get-dict.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/i18n/get-dict.ts)
* Create `apps/web/src/i18n/get-dict.ts`.
* Mark with `import 'server-only'`.
* Select the dictionary based on `getLanguageFromEnv()` and export the active `dict` and the active language `Language`.

#### [NEW] [dict-context.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/context/dict-context.tsx)
* Create `apps/web/src/context/dict-context.tsx`.
* Add `'use client'` directive.
* Expose `DictProvider` which mounts a React context provider, accepting `value={dict}` prop.
* Expose `useDict()` hook which reads from the context and throws when it returns `null` or is used outside the provider.

#### [MODIFY] [index.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/i18n/index.ts)
* Re-export `dict` and the loader output from `get-dict.ts`.

#### [MODIFY] [layout.tsx](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/app/layout.tsx)
* Import `dict` from `@web/i18n` and `DictProvider` from `@web/context/dict-context`.
* Wrap the main app structure: `<DictProvider value={dict}><AuthProvider>{children}</AuthProvider></DictProvider>`.

## Verification Plan

### Automated Tests
- Run `tsc --noEmit`, `make lint-web` and `make test-web` to ensure strict TS and no errors.
