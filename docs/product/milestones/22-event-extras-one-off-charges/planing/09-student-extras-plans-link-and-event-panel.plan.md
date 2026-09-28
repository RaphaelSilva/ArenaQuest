# Plan — Task 09: Student extras, plans-tab link and event charges panel

**Task:** [09-student-extras-plans-link-and-event-panel.task.md](../09-student-extras-plans-link-and-event-panel.task.md)
**RFC:** [RFC 0015](../../../RFCs/0015-event-extras-one-off-charges-for-events.md) §8
**Branch:** `feature/m22/09-student-extras-plans-link-and-event-panel.task`
**Persona:** frontend-developer (apps/web only — the API is merged and is not edited here)

## Goal

Close the three remaining RFC 0015 §8 surfaces:

1. `/settings/billing` — the contract section stays as it is; a separate **Extras** section
   renders `statement.extras` (its own standing badge, outstanding, one row per charge with
   event title, event date, due date, amount, balance and a status label), with an empty
   state when the student has no charge.
2. Admin **plans tab** — the recurring note gains a link to the Extras tab.
3. Admin **event page** — a read-only **Charges** panel (charged, adjustments, received,
   outstanding, counts by status) from `GET /v1/admin/billing/events/{id}/summary`, with a
   link to the Extras tab pre-selected on that event; hidden when the event has no price and
   no charge. GET only.

## Files to touch

| File | Change |
|---|---|
| `apps/web/src/lib/admin-billing-api.ts` | `BillingStudentStatement.extras` becomes **required** (the API always sends it). The summary call already exists (`extras.summary`, Task 07). |
| `apps/web/src/components/billing/__tests__/statement-fixture.ts` | `emptyStatement` gains `extras: { standing: 'good', oldestOverdueDate: null, outstandingMinor: 0, charges: [] }`; new `extrasCharge()` fixture helper. |
| `apps/web/src/app/(protected)/admin/billing/__tests__/student-statement-panel.test.tsx` | Fixture gains the now-required `extras` if it omitted it (type only). |
| `apps/web/src/app/(protected)/admin/billing/__tests__/ledger-tab.test.tsx` | Fixture gains the now-required `extras` (type only). |
| `apps/web/src/app/(protected)/settings/billing/page.tsx` | Extras section. `isEmptyStatement` additionally requires zero charges, so an extras-only buyer sees the contract/invoice sections' own empties instead of "nothing on your account". |
| `apps/web/src/app/(protected)/settings/billing/__tests__/page.test.tsx` | New cases. |
| `apps/web/src/app/(protected)/admin/billing/plans-tab.tsx` | Optional `onOpenExtras?: () => void`; renders `<a href="/admin/billing?tab=extras">` after the recurring note; on click with the callback present, `preventDefault()` + callback (in-page tab switch). |
| `apps/web/src/app/(protected)/admin/billing/page.tsx` | **Deviation (see below).** Reads `?tab=` and `?eventId=` once through `useSearchParams` (default export wrapped in `<Suspense>`, as `admin/access` does); a known tab is the initial tab; `eventId` is passed to `ExtrasTab` as `initialEventId`. Passes `onOpenExtras={() => setTab('extras')}` to `PlansTab`. |
| `apps/web/src/app/(protected)/admin/billing/extras-tab.tsx` | **Deviation.** Optional `initialEventId?: string` seeds the event selector state. |
| `apps/web/src/app/(protected)/admin/events/[eventId]/event-charges-panel.tsx` (new) | The read-only panel. |
| `apps/web/src/app/(protected)/admin/events/[eventId]/page.tsx` | Mount `<EventChargesPanel eventId=… />` under the form, admins only (`canPublish` — the billing API is ADMIN-only; a content creator would get 403). |
| `apps/web/src/app/(protected)/admin/events/__tests__/event-charges-panel.test.tsx` (new) | Component tests. |
| `apps/web/src/app/(protected)/admin/billing/__tests__/{plans-tab,billing-page,extras-tab}.test.tsx` | Link + deep-link cases. |
| `apps/web/src/i18n/dict-en.ts`, `dict-pt.ts` | New keys (identical sets). |

### Deviation: `admin/billing/page.tsx` and `extras-tab.tsx`

The guardrail lists `plans-tab.tsx` only under `admin/billing`, but the acceptance criteria
require the links to *open the Extras tab* and *on that event*. The console keeps its tab in
local state and the Extras tab keeps its event in local state, so no URL can reach either
without a minimal read of the query string in `page.tsx` and a seed prop on `ExtrasTab`.
`useSearchParams` is read as initial state (a Next `Link` navigation may render before
`window.location` updates, so reading `window` is unreliable); the page's default export gains
the Suspense boundary the static prerender requires. No behaviour changes when the query is absent.

## Contracts

```ts
// admin-billing-api.ts
export type BillingStudentStatement = { …; extras: BillingStatementExtras };

// plans-tab.tsx
export function PlansTab(props: { currency: BillingReportCurrency | null; onOpenExtras?: () => void });

// extras-tab.tsx
export function ExtrasTab(props: { …; initialEventId?: string });

// event-charges-panel.tsx
export const EXTRAS_TAB_HREF = '/admin/billing?tab=extras';
export function extrasTabHrefFor(eventId: string): string; // `${EXTRAS_TAB_HREF}&eventId=${encodeURIComponent(eventId)}`
export function EventChargesPanel(props: { eventId: string });
```

Panel data flow: `Promise.all([extras.getPrice(id), extras.summary(id), reports.aging()])` —
three `GET`s. `aging()` only supplies the display currency (exponent + symbol), as
`/admin/billing` already does; its failure leaves amounts rendered as "Not shown (CODE)"
through the shared `Money` component. Hidden (`null` render) when `price === null &&
summary.chargeCount === 0`. On a summary failure, a translated error line.

Per-charge label on the student page: `void` → Void; `paid` or zero balance → Paid; open with
positive balance and `statement.asOf >= dueDate` → **Overdue**; otherwise Open. This mirrors
the server's own `overdueCharges` predicate in `resolveExtrasRail` exactly (the statement
carries no per-charge flag, and AC1 requires the charge to read as overdue). The rail
standing itself is never derived — the badge renders `extras.standing` as sent.

Event date: `eventStartsAt.slice(0, 10)` (ISO date, as the page already renders ISO dates);
`d.none` when null.

## Tests → acceptance criteria

| AC | Test |
|---|---|
| Paid-up contract + one overdue charge → contract unchanged, Extras shows it overdue with the title | `settings/billing/__tests__/page.test`: `statementWith('good', { extras: delinquent + one charge due before asOf })` → contract heading/terms and invoices still render; Extras section (region by heading) shows the delinquent badge, event title, event date, due date, balance and the "Overdue" label. |
| No charge → only the empty state | `page.test`: `statementWith('good')` → Extras region contains only `extras.empty` (plus heading); `emptyStatement()` still shows `emptyStatement` copy. Extras-only buyer → contract/invoice empties, not the "nothing on your account" copy. |
| Plans tab link opens Extras | `plans-tab.test`: link with `name = links.extras` has `href=/admin/billing?tab=extras`; clicking calls `onOpenExtras`. `billing-page.test`: click the plans tab, click the link → Extras tab `aria-selected`. |
| Event page Charges summary + link on that event; GET only | `event-charges-panel.test`: summary amounts/counts shown, link `href=/admin/billing?tab=extras&eventId=e1`; every transport call is `GET`; no price + zero charges → nothing rendered; summary failure → alert. `billing-page.test`: `?tab=extras&eventId=e1` in `window.location` → Extras tab selected; `extras-tab.test`: `initialEventId` → price/summary requested for that event. |
| `no-withholding` unchanged | Existing test runs unchanged. |
| i18n | Keys in both dicts (typed `Dictionary`), `node apps/web/scripts/check-i18n-coverage.js`. |
| Lint/tests/scope | below. |

## Verification

```bash
make lint
make test-web                                 # alone
node apps/web/scripts/check-i18n-coverage.js
(cd apps/web && pnpm exec tsc --noEmit)       # baseline: 6 errors in catalog/topic-tree tests
git diff --stat feature/m22/candidate
```
