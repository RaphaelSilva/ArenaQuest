import { describe, it, expect, vi, afterEach } from 'vitest';

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

// next/font/google is not available in the test runtime — stub the loaders.
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
  Space_Grotesk: () => ({ variable: '--font-space-grotesk' }),
  JetBrains_Mono: () => ({ variable: '--font-jetbrains-mono' }),
}));

async function loadMetadata() {
  const mod = await import('../layout');
  return mod.metadata;
}

describe('Root layout metadata — brand-driven title/description', () => {
  afterEach(() => {
    Object.assign(brandMock, { fullName: 'ArenaQuest' });
    vi.resetModules();
  });

  it('resolves title and description from a custom brand.fullName', async () => {
    Object.assign(brandMock, { fullName: 'AcmeLearn' });
    const metadata = await loadMetadata();
    expect(metadata.title).toBe('AcmeLearn');
    expect(metadata.description).toBe('AcmeLearn learning platform');
  });
});
