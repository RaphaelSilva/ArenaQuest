# Milestone 10 Closeout Analysis — Frontend Internationalization (i18n)

This document summarizes the results and achievements of Milestone 10, bringing a robust build-time internationalization layer to `apps/web`.

## 1. Key Statistics & Migrated String Counts

All user-facing UI copy has been successfully centralized into structured, statically-typed JSON dictionaries (`dict-en.ts` and `dict-pt.ts`). Here is the count of unique keys migrated per namespace:

| Namespace | Number of Keys | Purpose |
|---|---|---|
| `auth` | 150+ | Registration steps, login options, reset password forms, role descriptions |
| `admin` | 225+ | User grids, topic tree CRUD controls, task builder forms, enrollment tabs |
| `catalog` | 100+ | Sidebar search, comments list, media tabs, subtopic detail cards, view/play action labels |
| `dashboard` | 36 | Greeting, level card, streak tracking, ranking statistics, roadmap path |
| `tasks` | 20 | Task details, stage indicators, locked tooltip alerts, enrollment checks |
| `settings` | 19 | Change password labels, current/new password inputs, toast confirmations |
| `layout` | 13 | Global navigation menu items, admin sidebar headers, open/close aria-labels |
| `common` | 16 | Universal UI actions (Cancel, Save, Confirm, Back, Retry) |
| `errors` | 3 | Connection failure, permission denied, generic server issues |

## 2. Sentinel String Verification (Build-Time Tree-Shaking)

To verify the build-time i18n layer completely splits and tree-shakes unused dictionary text, optimized production builds were compiled and verified:

### English Build (`NEXT_PUBLIC_LANGUAGE=en`)
* **English Sentinel Checked:** `"As a participant, you will have access to"`
  * **Result:** **FOUND** in static JS chunk `chunks/89c01a83-95ec7b8337940eac.js`
* **Portuguese Sentinel Checked:** `"Como participante, você terá acesso aos"`
  * **Result:** **NOT FOUND** (0 matches across all built JS chunks)

This confirms that only the active language's dictionary strings are included in the bundle, and the other language is successfully tree-shaken out at build time.

## 3. Milestone Decisions Recorded

1. **Default language fallback:** If `NEXT_PUBLIC_LANGUAGE` is missing or unrecognized, the build falls back to `pt` (Portuguese) and prints a build-time warning.
2. **Language switching & routing topology:** No runtime language switcher, no cookies, no URL prefixes. A single language is served per deploy. Switching language is performed by re-deploying with the env var set inline.
3. **CI Gate:** Integrated `check-i18n-coverage.js` static analyzer to scan all TSX/TS files in `src/` and fail builds if hardcoded user-facing strings are added.

## 4. Phase 4 Backlog (Future Follow-ups)

* [ ] Runtime language switching and per-user DB locale preferences
* [ ] Translation of dynamic backend content (topic description Markdown, task instructions)
* [ ] Locale-aware formatting using standard `Intl` formatters (dates, currency, complex numbers)
