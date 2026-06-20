# RFC 0006: White-label branding and Cloudflare build tooling

**Date:** 2026-06-19
**Status:** Draft
**Author:** raphaelsilva
**Affected:**
- `apps/web/src/components/design-system/Logo.tsx` (configurable sigla + label)
- `apps/web/src/app/(auth)/auth/callback/page.tsx` (de-duplicate the inline logo)
- `apps/web/src/app/page.tsx` (footer copyright + new "powered by" attribution)
- `apps/web/src/app/layout.tsx` (document `title` / `description` metadata)
- `apps/web/next.config.ts` (expose new build-time `NEXT_PUBLIC_BRAND_*` env)
- `apps/web/src/i18n/dict-en.ts` + `dict-pt.ts` (new "Powered by" key)
- `apps/web/src/lib/brand.ts` (**new** — single source of truth for brand config)
- `apps/web/src/app/icon.tsx` (**new** — build-time per-brand favicon)
- `apps/web/src/app/favicon.ico` (**removed** — replaced by the generated icon)
- `scripts/BuildToCloudFlare.sh` (**new** — white-label build/deploy helper)
- `apps/web/.env.whitelabel.example` (**new** — documented brand variables)
- `docs/product/RFCs/README.md` (index entry)

---

## Summary

Make ArenaQuest **white-labelable at build time**: the brand mark
(today a hardcoded `AQ` badge next to a two-tone `Arena`+`Quest`
wordmark) becomes `<Sigla> <LabelName>` driven by build-time
environment variables, while the **color system stays exactly as it is
today** (the existing `--aq-*` CSS variables and the accent split are
untouched). When a deployer does not override the brand, the defaults
resolve to **ArenaQuest** — so the stock build is byte-for-byte the
same product we ship now.

A small **"Powered by ArenaQuest"** attribution is added to the public
footer, shown whenever the brand has been customised (and optionally
always), so the underlying platform keeps its credit.

The **browser favicon is generated per brand at build time** from the
same sigla badge, so a rebranded deployment also gets a matching tab
icon — no hand-made `.ico` required.

To keep the growing list of build-time knobs (API URL, language, and
now the brand variables) from being forgotten, we add a single
**`scripts/BuildToCloudFlare.sh`** that assembles every required
variable from a brand profile, runs the Cloudflare Pages build, and
optionally pushes the deploy — **inspired by the `Makefile` targets but
without modifying the `Makefile`**, which keeps owning the default
(always-ArenaQuest) flow.

## Motivation

The product is being offered as a white-label platform: partners want
their own sigla and name on the shell, but the visual identity
(layout, spacing, and the **color palette**) should stay the
platform's. Two concrete problems block this today:

1. **The brand is hardcoded in several places, inconsistently.** The
   canonical `Logo` component literally renders the string `AQ` and the
   split wordmark `Arena`+`Quest`
   ([Logo.tsx:42](../../../apps/web/src/components/design-system/Logo.tsx#L42),
   [:54](../../../apps/web/src/components/design-system/Logo.tsx#L54)).
   Worse, the OAuth callback screen **re-implements the same badge
   inline** instead of using `<Logo>`
   ([auth/callback/page.tsx:70](../../../apps/web/src/app/(auth)/auth/callback/page.tsx#L70)),
   so any rebrand has to be done twice. The footer copyright
   ([page.tsx:406](../../../apps/web/src/app/page.tsx#L406)) and the
   document metadata ([layout.tsx:28](../../../apps/web/src/app/layout.tsx#L28))
   each carry their own literal `"ArenaQuest"`.

2. **Build-time configuration is spread across two mechanisms and easy
   to forget.** `NEXT_PUBLIC_LANGUAGE` is wired through
   `next.config.ts`'s `env` block
   ([next.config.ts:11](../../../apps/web/next.config.ts#L11)), while
   `NEXT_PUBLIC_API_URL` is injected ad-hoc on the `deploy-web` /
   `deploy-web-staging` Makefile lines
   ([Makefile:94](../../../Makefile#L94),
   [:98](../../../Makefile#L98)). Adding three or four brand variables
   to this scattered setup invites a half-configured deploy (right name,
   wrong API URL, missing sigla).

A white-label build is exactly the situation where "I forgot one
variable" produces an embarrassing result (a partner's site that still
says ArenaQuest). Centralising the brand into one config module and one
build script removes that failure mode.

## Goals & Non-Goals

**Goals**
- Render the brand mark as **`<Sigla> <LabelName>`**, both supplied at
  build time, defaulting to `AQ` / `ArenaQuest`.
- **Preserve the current colors and accent split unchanged.** The badge
  background stays `--aq-accent`, the wordmark keeps the two-tone accent
  on its trailing segment, and no palette variable is renamed or
  recolored by this RFC.
- **One source of truth** for brand values (`src/lib/brand.ts`), read by
  every surface (`Logo`, footer, metadata, the de-duplicated callback
  screen).
- A **"Powered by ArenaQuest"** footer attribution that survives
  rebranding.
- A **per-brand favicon generated at build time** from the sigla badge,
  staying in sync with the on-screen mark with no manual asset work.
- A single **`BuildToCloudFlare.sh`** that gathers all build-time
  variables from a brand profile, builds, and optionally deploys —
  **leaving the `Makefile` untouched** as the default-brand path.
- **Zero behaviour change for the stock build** — with no overrides the
  output is identical to today (defaults = ArenaQuest).
- **Respect the i18n contract (RFC 0002).** Brand values are *config*,
  not translatable copy; the only translatable string introduced
  ("Powered by") goes through the dictionaries.

**Non-Goals**
- **Theme/palette customisation per tenant.** Colors stay as they are;
  swapping `--aq-accent` and friends per deployer is a separate,
  larger effort (see Alternatives → "Full theming").
- **Runtime / multi-tenant branding.** This is **build-time, one brand
  per deployment**, matching how `NEXT_PUBLIC_*` already works. A single
  Worker/Pages project serving many brands from one build is out of
  scope.
- **Custom logo images / SVG upload.** The mark stays the
  `sigla badge + wordmark` construction; uploading a raster/SVG logo is
  a follow-up.
- **OG / social share image** per brand. The favicon **is** covered
  (§9); the Open-Graph preview image is a follow-up — it needs layout
  design beyond the badge, not just the sigla.
- **Changing the API.** Branding is entirely a frontend + build concern;
  `apps/api` is not touched.
- **Modifying the `Makefile`.** It keeps owning the default ArenaQuest
  build/deploy; the new script wraps the same commands for white-label
  profiles.

## Current State (for reference)

**The brand mark** — `Logo` accepts only layout props (`size`,
`showIcon`, `showText`, …); the strings are literals:

```tsx
// apps/web/src/components/design-system/Logo.tsx
//   badge:
AQ
//   wordmark (accent on the trailing segment):
Arena<span style={{ color: 'var(--aq-accent)' }}>Quest</span>
```

**Duplicated mark** — the OAuth callback screen does not use `<Logo>`;
it hand-rolls the same badge and wordmark inline
([auth/callback/page.tsx:70-71](../../../apps/web/src/app/(auth)/auth/callback/page.tsx#L70)).

**Other literals** — footer copyright
(`© {year} ArenaQuest. …`, [page.tsx:406](../../../apps/web/src/app/page.tsx#L406))
and document metadata
(`title: "ArenaQuest"`, [layout.tsx:28](../../../apps/web/src/app/layout.tsx#L28)).

**Favicon** — a single static `apps/web/src/app/favicon.ico` served by
the Next.js file convention (there is no `<link rel="icon">` in
`layout.tsx`). It is the ArenaQuest mark, baked once; nothing reads the
brand config.

**Build-time config** — two mechanisms:
- `next.config.ts` `env: { NEXT_PUBLIC_LANGUAGE }` (build-baked).
- Makefile deploy lines prefix `NEXT_PUBLIC_API_URL=…` per environment.

## Proposed Design

### 1. Brand config module (single source of truth)

A new `apps/web/src/lib/brand.ts` reads the build-time env once and
exposes a typed, defaulted object. Defaults reproduce today's brand.

```ts
// apps/web/src/lib/brand.ts
export interface BrandConfig {
  /** Short mark inside the accent badge, e.g. "AQ". */
  sigla: string;
  /** Full label. Rendered as <namePrefix><nameAccent>. */
  namePrefix: string;
  /** Trailing segment of the label, rendered in --aq-accent. */
  nameAccent: string;
  /** Badge background, sRGB hex — for the favicon (Satori has no oklch). */
  accentHex: string;
  /** Badge text colour, sRGB hex. */
  onAccentHex: string;
  /** Convenience: the full plain-text name (prefix + accent). */
  fullName: string;
  /** Whether the brand was customised (any var overridden). */
  isCustom: boolean;
  /** Show the "Powered by ArenaQuest" footer attribution. */
  showPoweredBy: boolean;
}

const sigla       = process.env.NEXT_PUBLIC_BRAND_SIGLA       || 'AQ';
const namePrefix  = process.env.NEXT_PUBLIC_BRAND_NAME_PREFIX || 'Arena';
const nameAccent  = process.env.NEXT_PUBLIC_BRAND_NAME_ACCENT || 'Quest';

// Badge colours, in sRGB hex, for surfaces that cannot read the CSS
// `--aq-accent` variable — notably the build-time favicon (Satori does
// not support `oklch()`). Defaults mirror today's palette in
// globals.css; `NEXT_PUBLIC_BRAND_ACCENT` is an OPTIONAL override only
// for partners who also rebrand the favicon — the on-screen palette is
// still driven by the CSS variables and is unchanged.
const accentHex   = process.env.NEXT_PUBLIC_BRAND_ACCENT || '#F08C3A'; // ≈ oklch(0.74 0.19 52)
const onAccentHex = '#0B0E17';                                          // --aq-bg, the badge text colour

const isCustom =
  !!(process.env.NEXT_PUBLIC_BRAND_SIGLA ||
     process.env.NEXT_PUBLIC_BRAND_NAME_PREFIX ||
     process.env.NEXT_PUBLIC_BRAND_NAME_ACCENT);

export const brand: BrandConfig = {
  sigla,
  namePrefix,
  nameAccent,
  accentHex,
  onAccentHex,
  fullName: `${namePrefix}${nameAccent}`,
  isCustom,
  // Default: show attribution only on customised builds. A deployer can
  // force it on/off explicitly.
  showPoweredBy:
    process.env.NEXT_PUBLIC_BRAND_POWERED_BY === 'true'  ? true  :
    process.env.NEXT_PUBLIC_BRAND_POWERED_BY === 'false' ? false :
    isCustom,
};
```

**Why split the name into `prefix` + `accent` rather than one
`NEXT_PUBLIC_BRAND_NAME`.** Today's wordmark colors the *trailing*
segment (`Quest`) with `--aq-accent`. A single full-name string would
force us to guess where to apply the accent. Two explicit segments keep
the exact current rendering (`Arena` + accented `Quest`) and let a
partner choose their own split (e.g. `Acme` + `Learn`), or put the whole
name in `namePrefix` and leave `nameAccent` empty for a single-tone
wordmark. **The colors themselves do not change** — only which text the
existing accent wraps.

### 2. `Logo` consumes the brand config

`Logo` keeps its layout props and signature; only the literals are
replaced by `brand` values. No color/markup change.

```tsx
// badge
{brand.sigla}
// wordmark
{brand.namePrefix}
{brand.nameAccent && (
  <span style={{ color: 'var(--aq-accent)' }}>{brand.nameAccent}</span>
)}
```

Because every existing call site already uses `<Logo …/>`
([page.tsx:256](../../../apps/web/src/app/page.tsx#L256),
[hero-panel.tsx:18](../../../apps/web/src/components/auth/hero-panel.tsx#L18),
[nav.tsx](../../../apps/web/src/components/layout/nav.tsx), the reset /
forgot / activate auth screens), they inherit the brand for free.

### 3. De-duplicate the OAuth callback mark

Replace the hand-rolled badge/wordmark in
[auth/callback/page.tsx:69-72](../../../apps/web/src/app/(auth)/auth/callback/page.tsx#L69)
with `<Logo />`. This removes the only place the mark is drawn outside
the component, so there is exactly **one** implementation to keep
correct. (The surrounding inline styles there match `Logo`'s output, so
this is a visual no-op for the default brand.)

### 4. Footer copyright + "Powered by" attribution

- Replace the literal in [page.tsx:406](../../../apps/web/src/app/page.tsx#L406)
  with `© {year} {brand.fullName}. …` (the trailing sentence stays an
  i18n string per RFC 0002).
- When `brand.showPoweredBy` is true, render a small **"Powered by
  ArenaQuest"** line in the footer. `"Powered by"` is a new dictionary
  key (`dict-en.ts` / `dict-pt.ts`); **"ArenaQuest" is a deliberate
  constant** here — it is the underlying platform's name, not the
  deployer's brand, so it is intentionally *not* driven by `brand.*`.

### 5. Document metadata

`layout.tsx` `metadata.title` / `description` read `brand.fullName`
instead of the literal. (Metadata is evaluated at build time in a Server
Component, so `process.env.NEXT_PUBLIC_*` is inlined correctly.)

### 6. Expose the new env in `next.config.ts`

Add the brand variables to the existing `env` block so they are baked
into the static export exactly like `NEXT_PUBLIC_LANGUAGE`:

```ts
env: {
  NEXT_PUBLIC_LANGUAGE: process.env.NEXT_PUBLIC_LANGUAGE || 'pt',
  NEXT_PUBLIC_BRAND_SIGLA: process.env.NEXT_PUBLIC_BRAND_SIGLA || 'AQ',
  NEXT_PUBLIC_BRAND_NAME_PREFIX: process.env.NEXT_PUBLIC_BRAND_NAME_PREFIX || 'Arena',
  NEXT_PUBLIC_BRAND_NAME_ACCENT: process.env.NEXT_PUBLIC_BRAND_NAME_ACCENT || 'Quest',
  NEXT_PUBLIC_BRAND_POWERED_BY: process.env.NEXT_PUBLIC_BRAND_POWERED_BY || '',
},
```

### 7. i18n contract (RFC 0002) compliance

`check-i18n-coverage.js` forbids hardcoded user-facing strings in
`src/{app,components,hooks}`. Brand values are **read from `brand.*`
(env-backed), not written as literals in components**, so they do not
trip the checker. The single new *translatable* string ("Powered by")
lives in both dictionaries with identical keys. We confirm the checker
still passes; if it flags the platform-constant `"ArenaQuest"` in the
"powered by" line, that literal is moved into `brand.ts` as an exported
constant (`PLATFORM_NAME = 'ArenaQuest'`) so no literal sits in a
component.

### 8. `BuildToCloudFlare.sh` — white-label build helper

A new `scripts/BuildToCloudFlare.sh` that:

1. **Loads a brand profile** — an env file passed as `--profile <file>`
   (e.g. `apps/web/.env.whitelabel`), or individual `--sigla`,
   `--name-prefix`, `--name-accent`, `--api-url`, `--language`,
   `--powered-by` flags, or plain environment variables. Flags override
   the profile; the profile overrides the shell env.
2. **Defaults to ArenaQuest** for any variable left unset — so running
   it with no profile reproduces the stock build (parity with the
   Makefile).
3. **Validates** that the required variables resolve (notably
   `NEXT_PUBLIC_API_URL` and the target Pages project) and **prints a
   summary table** of the effective brand + URLs before building, so a
   misconfiguration is caught before deploy, not after.
4. **Builds** via the same command the Makefile uses
   (`pnpm --filter web pages:build`) with the assembled
   `NEXT_PUBLIC_*` exported.
5. **Optionally deploys** when `--deploy` (or `--deploy --env staging`)
   is passed, calling the same
   `wrangler pages deploy .vercel/output/static --project-name=…` line
   as `deploy-web` / `deploy-web-staging`. Without `--deploy` it stops
   after the build (dry-run friendly).

```bash
# Default ArenaQuest build (parity with `make deploy-web`, build only):
scripts/BuildToCloudFlare.sh --api-url https://api.raphael-1d2.workers.dev

# White-label partner, build + deploy to a Pages project:
scripts/BuildToCloudFlare.sh \
  --profile apps/web/.env.whitelabel.acme \
  --api-url https://api.acme.example.com \
  --project acme-web \
  --deploy
```

The script **does not modify the Makefile** and is **inspired by**, not
a replacement for, its targets: the Makefile remains the canonical
default-brand (always-ArenaQuest) flow; the script is the white-label
superset that guarantees every knob is set in one place.

A committed **`apps/web/.env.whitelabel.example`** documents every
variable with the ArenaQuest defaults, so a new partner profile is a
copy-and-edit.

### 9. Per-brand favicon (build-time, static)

Today the favicon is a static `app/favicon.ico` that nothing reads the
brand from. Replace it with a generated icon driven by `brand`, using
the App Router's metadata-file convention so Next emits the
`<link rel="icon">` automatically.

```tsx
// apps/web/src/app/icon.tsx
import { ImageResponse } from 'next/og';
import { brand } from '@web/lib/brand';

// Pre-render once at build time → emitted as a static asset, no runtime
// Worker. Required for the @cloudflare/next-on-pages static export.
export const dynamic = 'force-static';
export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: brand.accentHex,          // sRGB hex — Satori has no oklch()
          color: brand.onAccentHex,
          fontSize: 30, fontWeight: 700,
          fontFamily: 'sans-serif',
          borderRadius: 12,
        }}
      >
        {brand.sigla}
      </div>
    ),
    { ...size },
  );
}
```

Key points:

- **Build-time, static.** `export const dynamic = 'force-static'` makes
  Next pre-render the PNG into the static output, so it ships as a plain
  asset under `@cloudflare/next-on-pages` — **no edge function, no
  per-request cost**. This is what lets the favicon vary per brand
  without runtime branding (it is baked at build like every other
  `NEXT_PUBLIC_*`).
- **Why a hex, not `--aq-accent`.** `ImageResponse` renders via Satori,
  which does **not** support `oklch()` (how `--aq-accent` is defined in
  `globals.css`). `brand.accentHex` carries an sRGB equivalent of the
  current accent; the **on-screen palette is unchanged** — this hex
  exists only so the off-DOM image renderer has a colour it understands.
- **Remove the static `favicon.ico`.** If both `favicon.ico` and
  `icon.tsx` exist, browsers may prefer the stale `.ico`. Deleting it
  leaves `icon.tsx` as the single source, consistent with the on-screen
  badge.
- **Default brand parity.** With no overrides the generated icon is the
  `AQ` badge on the current accent — visually equivalent to today's
  favicon (a one-time, intentional asset swap noted in Success
  Criteria).
- **OG/social image stays out of scope** (Non-Goals): it needs a
  composed layout, not just the sigla, and is a follow-up.

## Alternatives Considered

1. **Single `NEXT_PUBLIC_BRAND_NAME` (no prefix/accent split).**
   *Rejected:* loses the current two-tone wordmark, or forces a fragile
   heuristic for where to apply the accent. The two-segment model
   reproduces today's rendering exactly and is still simple for a
   single-tone brand (empty `nameAccent`).
2. **Full per-tenant theming (palette via env / CSS variables).**
   *Deferred, not rejected:* the user explicitly wants the colors kept
   as-is, and theming multiplies QA surface (contrast, accent on text,
   dark shell). Out of scope here; the `brand.ts` seam leaves room for a
   later `theme.ts` sibling.
3. **Runtime branding (one build, brand chosen per request/host).**
   *Rejected for now:* the platform's config is uniformly build-time
   `NEXT_PUBLIC_*`; runtime branding needs a tenant resolver, edge
   config, and cache-key changes — a different RFC.
4. **Add brand vars to the Makefile deploy lines.** *Rejected by
   request:* the Makefile must stay the default (ArenaQuest) flow
   untouched. A dedicated script avoids per-partner Makefile edits and
   centralises validation/summary that the Makefile one-liners cannot
   express cleanly.
5. **Upload a logo image per brand.** *Rejected for v1:* heavier
   (storage, sizing, dark/light variants); the sigla+wordmark covers the
   stated need (`<Sigla> <LabelName>`). Follow-up.

## Implementation Plan

Estimated total: **~1–1.5 dev days.**

### Phase 1 — Brand config + component wiring (~0.5 d)
- Add `apps/web/src/lib/brand.ts` with defaults = ArenaQuest.
- Replace literals in `Logo.tsx` with `brand.*` (no color/markup change).
- Swap the inline mark in `auth/callback/page.tsx` for `<Logo />`.
- Footer copyright + `metadata` read `brand.fullName`.
- Add the `"Powered by"` key to `dict-en.ts` + `dict-pt.ts`; render the
  attribution when `brand.showPoweredBy`.
- Add `app/icon.tsx` (build-time `force-static` favicon) and **remove the
  static `favicon.ico`**; confirm `next-on-pages` emits it as a static
  asset (not an edge function).
- Expose the new vars in `next.config.ts` (incl. optional
  `NEXT_PUBLIC_BRAND_ACCENT`).
- Verify `check-i18n-coverage.js` passes.

### Phase 2 — Build tooling (~0.5 d)
- Add `scripts/BuildToCloudFlare.sh` (profile loading, defaults,
  validation, summary, build, optional deploy).
- Add `apps/web/.env.whitelabel.example` documenting every variable.
- Smoke-test: default invocation builds an ArenaQuest bundle identical
  to `make deploy-web` (build step); a sample partner profile builds a
  rebranded bundle.

### Phase 3 — Verification (~0.25 d)
- Default build: visually identical to today (badge, wordmark accent,
  footer, title) — **regression gate**.
- Custom build: `<Sigla> <LabelName>` everywhere the mark appears
  (landing, nav, auth screens, OAuth callback), footer copyright shows
  the brand, document title shows the brand, "Powered by ArenaQuest"
  visible.
- Toggle check: `NEXT_PUBLIC_BRAND_POWERED_BY=false` hides the
  attribution on a custom build; `=true` shows it on the default build.

## Tradeoffs & Risks

| Risk | Mitigation |
|---|---|
| **Build-time only** — a brand change requires a rebuild/redeploy | Accepted and intended; matches every other `NEXT_PUBLIC_*` knob. Runtime branding is a separate RFC (Alternatives 3). |
| A partner forgets a variable and ships a half-rebrand | `BuildToCloudFlare.sh` validates required vars and prints an effective-config summary **before** building; unset vars fall back to ArenaQuest rather than to blanks. |
| Two build paths (Makefile + script) drift | The script calls the **same** `pages:build` / `wrangler pages deploy` commands the Makefile uses; the Makefile stays the default-brand canonical path, the script is its white-label superset. A test asserts default-script output matches the Makefile build. |
| i18n checker flags the new strings | "Powered by" is dictionarised; brand values come from env (not literals); the platform constant, if flagged, moves into `brand.ts`. Checker run is part of Phase 1's exit. |
| Accent split looks wrong for some names | `nameAccent` is optional — empty yields a clean single-tone wordmark; colors are unchanged either way. |
| **Favicon generation adds an edge function / runtime cost** on Cloudflare | `export const dynamic = 'force-static'` pre-renders the PNG at build time into a static asset; Phase 1 explicitly verifies the `next-on-pages` output has no function for `/icon`. If a build ever can't statically pre-render it, fall back to a script-generated static SVG icon (no `ImageResponse`). |
| **Accent hex drifts from the `oklch()` palette** | `brand.accentHex` is documented as the sRGB mirror of `--aq-accent`, used only by the off-DOM image renderer; the on-screen palette still comes from the CSS variable, so the *page* never drifts. A custom favicon colour is an explicit opt-in (`NEXT_PUBLIC_BRAND_ACCENT`). |
| OG/social image still says ArenaQuest on a custom brand | Explicit Non-Goal / follow-up (needs a composed layout, not just the sigla) — a known gap, not a surprise. |

## Success Criteria

- With **no overrides**, the build is visually and behaviourally
  identical to today (defaults resolve to `AQ` / `ArenaQuest`); the i18n
  coverage check passes.
- Setting `NEXT_PUBLIC_BRAND_SIGLA` / `_NAME_PREFIX` / `_NAME_ACCENT`
  changes the mark to `<Sigla> <LabelName>` **everywhere** — landing,
  nav, all auth screens, and the OAuth callback — with the **same
  colors and accent treatment** as today.
- The OAuth callback no longer contains a hand-rolled logo; `<Logo>` is
  the single implementation.
- Footer copyright and document `<title>` reflect the configured brand.
- "Powered by ArenaQuest" appears on customised builds (and can be
  forced on/off via `NEXT_PUBLIC_BRAND_POWERED_BY`).
- The browser tab favicon shows the configured **sigla**, generated at
  build time as a **static** asset (the `next-on-pages` output has no
  edge function for `/icon`); the default build's favicon is the `AQ`
  badge on the current accent.
- `scripts/BuildToCloudFlare.sh` produces a default ArenaQuest bundle
  equivalent to `make deploy-web` (build step) and a rebranded bundle
  from a partner profile, printing an effective-config summary first;
  the **`Makefile` is unchanged**.

## Open Questions

1. **Default for `showPoweredBy`** — proposed: shown on customised
   builds, hidden on the stock ArenaQuest build (which already *is*
   ArenaQuest). Confirm this matches the licensing/attribution intent.
2. **Profile location & secrecy** — committed example
   (`.env.whitelabel.example`) plus per-partner gitignored profiles?
   Confirm whether partner profiles live in this repo or in deploy CI
   secrets.
3. **OG / social share image** per brand — deferred to a follow-up RFC
   (needs a composed layout beyond the sigla). The favicon is included
   here (§9); confirm the OG image can wait.
4. **Optional `NEXT_PUBLIC_BRAND_ACCENT`** — the only colour knob, and it
   is **favicon-only** (the on-screen palette stays the CSS `oklch()`
   variables, unchanged per the request). Confirm we want to expose even
   this favicon-scoped override now, or hardcode the accent hex and add
   the override later.

## References

- Canonical mark: `apps/web/src/components/design-system/Logo.tsx`
- Duplicated mark to remove: `apps/web/src/app/(auth)/auth/callback/page.tsx:69`
- Footer copyright: `apps/web/src/app/page.tsx:406`
- Document metadata: `apps/web/src/app/layout.tsx:28`
- Favicon to replace: `apps/web/src/app/favicon.ico` (static, brand-agnostic)
- Dynamic-icon convention: Next.js App Router `app/icon.tsx` + `ImageResponse` (`next/og`)
- Build-time env precedent: `apps/web/next.config.ts:10` (`NEXT_PUBLIC_LANGUAGE`)
- Deploy commands to mirror (not modify): `Makefile:93-99` (`deploy-web*`)
- i18n contract: RFC 0002, `apps/web/scripts/check-i18n-coverage.js`
- CSS palette kept intact: `apps/web/src/app/globals.css` (`--aq-*`)
