import { dict } from '@web/i18n';

/**
 * The release-candidate preview strip.
 *
 * A preview build is the only one the deploy CLI stamps with
 * `NEXT_PUBLIC_PREVIEW_NAME` (the candidate, e.g. `m21`) and
 * `NEXT_PUBLIC_PREVIEW_SHA` (the short commit). Both are inlined at build time,
 * so this stays a Server Component with no state and no effect.
 *
 * **Zero footprint when off.** Local development, staging proper and
 * production have no preview name, and the component returns `null` — no
 * element, no class, no layout shift.
 *
 * It sits in normal flow above every route group (mounted once in the root
 * layout), never as a fixed overlay, so it cannot cover the navigation on a
 * narrow viewport. It is static text — no landmark, no live region.
 */
export function PreviewBanner() {
  const name = process.env.NEXT_PUBLIC_PREVIEW_NAME?.trim();
  if (!name) return null;
  const sha = process.env.NEXT_PUBLIC_PREVIEW_SHA?.trim() || undefined;

  return (
    <div
      data-testid="preview-banner"
      className="flex shrink-0 flex-wrap items-center justify-center gap-x-2 border-b border-[var(--aq-border2)] bg-[var(--aq-accent2-glow)] px-4 py-1 text-center text-xs text-[var(--aq-text)]"
    >
      <span className="font-mono font-semibold">{dict.previewBanner.label(name, sha)}</span>
      <span className="text-[var(--aq-text2)]">{dict.previewBanner.sharedData}</span>
    </div>
  );
}
