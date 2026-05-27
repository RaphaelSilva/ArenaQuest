# Plan — Task 02: Author EN and PT dictionaries with a shared `Dictionary` type

Detailed technical plan to compile the user-facing string inventory and define the dual-language typed dictionaries.

## Proposed Changes

### [Component] i18n Dictionaries & Type Contract

#### [NEW] [types.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/i18n/types.ts)
* Create `apps/web/src/i18n/types.ts`.
* Derive `Dictionary` type dynamically from one of the dictionaries (e.g. `typeof dictPt`).
* Export `Dictionary` type so both `dict-en.ts` and `dict-pt.ts` satisfy it.

#### [NEW] [dict-pt.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/i18n/dict-pt.ts)
* Create `apps/web/src/i18n/dict-pt.ts`.
* Define the Portuguese dictionary as `as const` object.
* Categorize keys under namespaces: `auth`, `admin`, `catalog`, `dashboard`, `tasks`, `enrollment`, `settings`, `layout`, `common`, `errors`.
* Dynamic values must use pure typescript functions taking appropriate arguments.

#### [NEW] [dict-en.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/i18n/dict-en.ts)
* Create `apps/web/src/i18n/dict-en.ts`.
* Define the English dictionary satisfying `Dictionary` shape via `satisfies Dictionary`.
* Match every Portuguese key exactly, providing high-quality English translations.

#### [MODIFY] [index.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/i18n/index.ts)
* Remove the `// TODO` comment.
* Re-export `dictEn`, `dictPt`, and the `Dictionary` type.

#### [NEW] [string-inventory.md](file:///home/my-ubuntu/projects/ArenaQuest/docs/product/milestones/10-frontend-i18n/string-inventory.md)
* Compile a comprehensive inventory document listing each namespace, key, file location, and original text.

## Verification Plan

### Automated Tests
- Run `tsc --noEmit` and `make test-web` to ensure strict TS compilation and no type mismatches across dictionaries.

### Manual Verification
- Deliberately delete one key from `dict-pt.ts` or `dict-en.ts` and verify that `tsc --noEmit` fails, confirming the type contract works perfectly.
