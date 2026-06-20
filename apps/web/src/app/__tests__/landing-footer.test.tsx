import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { dictPt } from '@web/i18n';

// Mutable brand mock so each test can drive fullName / showPoweredBy.
const brandMock = {
  sigla: 'AQ',
  namePrefix: 'Arena',
  nameAccent: 'Quest',
  accentHex: '#ff8101',
  onAccentHex: '#0B0E17',
  fullName: 'ArenaQuest',
  isCustom: false,
  showPoweredBy: false,
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

describe('Landing footer — brand-driven copyright & Powered-by', () => {
  afterEach(() => {
    Object.assign(brandMock, {
      fullName: 'ArenaQuest',
      showPoweredBy: false,
    });
    vi.resetModules();
  });

  it('footer copyright interpolates a custom brand.fullName and keeps the i18n rights sentence', async () => {
    Object.assign(brandMock, { fullName: 'AcmeLearn' });
    await renderLanding();
    const year = new Date().getFullYear();
    expect(
      screen.getByText(new RegExp(`© ${year} AcmeLearn\\. ${dictPt.landing.footer.rights}`))
    ).toBeInTheDocument();
  });

  it('shows the Powered-by line with the PLATFORM_NAME constant when showPoweredBy is true', async () => {
    Object.assign(brandMock, { fullName: 'AcmeLearn', showPoweredBy: true });
    await renderLanding();
    expect(
      screen.getByText(`${dictPt.landing.footer.poweredBy} ArenaQuest`)
    ).toBeInTheDocument();
  });

  it('hides the Powered-by line when showPoweredBy is false', async () => {
    Object.assign(brandMock, { fullName: 'AcmeLearn', showPoweredBy: false });
    await renderLanding();
    expect(
      screen.queryByText(`${dictPt.landing.footer.poweredBy} ArenaQuest`)
    ).not.toBeInTheDocument();
  });
});
