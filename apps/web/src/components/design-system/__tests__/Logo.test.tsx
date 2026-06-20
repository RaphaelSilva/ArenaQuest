import { render, screen } from '@testing-library/react';
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
}));

async function renderLogo() {
  const { Logo } = await import('../Logo');
  return render(<Logo />);
}

describe('Logo wordmark', () => {
  afterEach(() => {
    Object.assign(brandMock, {
      sigla: 'AQ',
      namePrefix: 'Arena',
      nameAccent: 'Quest',
    });
    vi.resetModules();
  });

  it('renders the stock AQ badge and Arena + accented Quest wordmark by default', async () => {
    const { container } = await renderLogo();
    expect(screen.getByText('AQ')).toBeInTheDocument();
    expect(screen.getByText('Arena')).toBeInTheDocument();
    const accent = screen.getByText('Quest');
    expect(accent.tagName).toBe('SPAN');
    expect(accent).toHaveStyle({ color: 'var(--aq-accent)' });
    // Badge keeps the accent variable background.
    const badge = screen.getByText('AQ');
    expect(badge).toHaveStyle({ background: 'var(--aq-accent)' });
    expect(badge).toHaveStyle({ color: '#0B0E17' });
    expect(container).toBeTruthy();
  });

  it('renders a custom sigla/prefix/accent with the accent treatment intact', async () => {
    Object.assign(brandMock, { sigla: 'MX', namePrefix: 'Max', nameAccent: 'Quiz' });
    await renderLogo();
    expect(screen.getByText('MX')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
    const accent = screen.getByText('Quiz');
    expect(accent.tagName).toBe('SPAN');
    expect(accent).toHaveStyle({ color: 'var(--aq-accent)' });
  });

  it('omits the accent span entirely for an empty nameAccent (single-tone)', async () => {
    Object.assign(brandMock, { sigla: 'MO', namePrefix: 'Mono', nameAccent: '' });
    const { container } = await renderLogo();
    expect(screen.getByText('Mono')).toBeInTheDocument();
    // The wordmark wrapper span exists, but no inner accent span.
    const innerSpans = container.querySelectorAll('span span');
    expect(innerSpans.length).toBe(0);
  });
});
