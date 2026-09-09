import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { dictPt } from '@web/i18n';

// Mutable brand mock: `whatsapp` is what selects the landing section under test.
const brandMock = {
  sigla: 'BUD',
  namePrefix: 'Tai',
  nameAccent: 'Budo',
  accentHex: '#8423c5',
  onAccentHex: '#0B0E17',
  fullName: 'TaiBudo',
  isCustom: true,
  showPoweredBy: true,
  whatsapp: '',
};

vi.mock('@web/lib/brand', () => ({
  get brand() {
    return brandMock;
  },
  PLATFORM_NAME: 'ArenaQuest',
}));

async function renderLanding() {
  const { default: LandingPage } = await import('../page');
  return render(<LandingPage />);
}

const intents = dictPt.landing.contact.intents;

describe('Landing CTAs — WhatsApp when the brand carries a number', () => {
  afterEach(() => {
    brandMock.whatsapp = '';
    vi.resetModules();
  });

  it('renders one wa.me link per intent, each with its own pre-filled message', async () => {
    brandMock.whatsapp = '5519999991155';
    await renderLanding();

    for (const intent of [intents.trial, intents.schedule, intents.teacher]) {
      const link = screen.getByRole('link', { name: new RegExp(intent.cta) });
      expect(link).toHaveAttribute(
        'href',
        `https://wa.me/5519999991155?text=${encodeURIComponent(intent.message)}`
      );
      // A chat opened from the site must not navigate the tab away from it.
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  it('replaces the placeholder plans instead of adding a fourth section', async () => {
    brandMock.whatsapp = '5519999991155';
    await renderLanding();

    expect(screen.getByText(dictPt.landing.contact.title)).toBeInTheDocument();
    expect(screen.queryByText('R$ 49')).not.toBeInTheDocument();
  });

  it('keeps the disabled plan CTAs for a tenant with no number', async () => {
    await renderLanding();

    expect(screen.queryByText(dictPt.landing.contact.title)).not.toBeInTheDocument();
    expect(screen.getByText('R$ 49')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: new RegExp(intents.trial.cta) })).toBeNull();
  });
});
