/**
 * The public entry point to the events board.
 *
 * The board exists so that a stranger with no account can find what is on.
 * The landing page is the only page such a visitor ever reaches, so a missing
 * link here makes the whole feature unreachable — that is what this pins.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { dictPt } from '@web/i18n';

vi.mock('@web/lib/brand', () => ({
  brand: {
    sigla: 'BUD',
    namePrefix: 'Tai',
    nameAccent: 'Budo',
    accentHex: '#8423c5',
    onAccentHex: '#0B0E17',
    fullName: 'TaiBudo',
    isCustom: true,
    showPoweredBy: true,
    whatsapp: '',
  },
  PLATFORM_NAME: 'ArenaQuest',
}));

async function renderLanding() {
  const { default: LandingPage } = await import('../page');
  return render(<LandingPage />);
}

describe('Landing page — the events board entry', () => {
  it('links to the public board', async () => {
    await renderLanding();
    expect(screen.getByRole('link', { name: dictPt.landing.nav.events })).toHaveAttribute(
      'href',
      '/events',
    );
  });

  /** In the topbar, beside the way in — where a visitor looks for a section. */
  it('offers it from the topbar, without requiring a sign-in first', async () => {
    await renderLanding();
    const topbar = screen.getByRole('banner');
    expect(
      within(topbar).getByRole('link', { name: dictPt.landing.nav.events }),
    ).toHaveAttribute('href', '/events');
  });

  it('labels it from the dictionary rather than a hardcoded string', async () => {
    await renderLanding();
    const link = screen.getByRole('link', { name: dictPt.landing.nav.events });
    expect(link).toHaveTextContent(dictPt.landing.nav.events);
  });
});
