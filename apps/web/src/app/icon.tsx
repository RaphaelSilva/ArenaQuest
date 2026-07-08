import { ImageResponse } from 'next/og';

import { brand } from '@web/lib/brand';

/**
 * Build-time generated favicon — the sigla badge rendered as a static asset.
 *
 * `force-static` makes Next pre-render the PNG into the static output so
 * `@cloudflare/next-on-pages` emits a plain asset (no edge function) for
 * `/icon`. The badge mirrors the on-screen `rounded-md` mark (see `Logo.tsx`),
 * but uses the brand's sRGB hex colors because the off-DOM Satori renderer
 * behind `ImageResponse` does not support `oklch()` / CSS variables. The
 * default font is used intentionally to keep the route dependency-free and
 * statically renderable — the goal is visual equivalence, not pixel-identical
 * typography.
 */
export const dynamic = 'force-static';

export const size = { width: 32, height: 32 };

export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: brand.accentHex,
          color: brand.onAccentHex,
          borderRadius: 6,
          fontSize: brand.sigla.length > 2 ? 12 : 15,
          fontWeight: 700,
          letterSpacing: '-0.5px',
        }}
      >
        {brand.sigla}
      </div>
    ),
    { ...size },
  );
}
