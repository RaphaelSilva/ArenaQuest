# Plan — Task 01: i18n module foundation and build-time language config

Detailed technical plan to implement the foundation of the frontend i18n system for `apps/web`.

## Proposed Changes

### [Component] i18n Foundation

#### [NEW] [config.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/i18n/config.ts)
* Create `apps/web/src/i18n/config.ts`.
* Define `Language` enum/union with exactly `'en'` and `'pt'`.
* Define the default language fallback constant `DEFAULT_LANGUAGE = 'pt'`.
* Implement `getLanguageFromEnv` which:
  - Reads `process.env.NEXT_PUBLIC_LANGUAGE` (or custom fallback).
  - Normalizes and verifies if it is inside the `Language` values set.
  - If absent or unrecognised, emits a single, clearly-prefixed warning on stdout and returns `DEFAULT_LANGUAGE`.
  - Ensures stdout warnings are throttled or printed only once during build execution (e.g., using a global cache/flag or simple log).

#### [NEW] [index.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/src/i18n/index.ts)
* Re-exports everything from `./config.ts`.
* Add `// TODO: dictionaries land in Task 02` placeholder comment.

#### [MODIFY] [next.config.ts](file:///home/my-ubuntu/projects/ArenaQuest/apps/web/next.config.ts)
* Update Next.js config to explicitly expose `NEXT_PUBLIC_LANGUAGE` in the `env` config option for robust client/server substitution.

## Verification Plan

### Automated Tests
- Run `make lint` and `make test-web` to ensure no syntax/eslint errors.

### Manual Verification
- Test build under four scenarios:
  1. `NEXT_PUBLIC_LANGUAGE=en make build-web` -> verifies EN resolution.
  2. `NEXT_PUBLIC_LANGUAGE=pt make build-web` -> verifies PT resolution.
  3. `NEXT_PUBLIC_LANGUAGE=xx make build-web` -> warning printed, falls back to PT.
  4. `make build-web` (unset) -> warning printed, falls back to PT.
