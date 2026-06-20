import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DictProvider } from '@web/context/dict-context';

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before the component imports
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  // No accessToken → renders the static shell (Logo + MissingTokenError).
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@web/hooks/use-auth', () => ({
  useAuth: () => ({ loginWithAccessToken: vi.fn() }),
}));

import OAuthCallbackPage from '../page';

function renderCallback() {
  return render(
    <DictProvider>
      <OAuthCallbackPage />
    </DictProvider>
  );
}

describe('OAuth callback — single mark via <Logo>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the shared <Logo> wordmark (badge + accented wordmark)', () => {
    renderCallback();
    // The mark comes from <Logo>: AQ badge + Arena/Quest wordmark.
    expect(screen.getByText('AQ')).toBeInTheDocument();
    expect(screen.getByText('Arena')).toBeInTheDocument();
    expect(screen.getByText('Quest')).toBeInTheDocument();
  });

  it('no longer renders an inline hand-rolled badge (no 34px inline-styled mark)', () => {
    const { container } = renderCallback();
    // The removed inline badge used `width: 34px` and the wordmark `font-size: 18px`.
    const inlineSized = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter(
      (el) => el.style.width === '34px' || el.style.fontSize === '18px'
    );
    expect(inlineSized).toHaveLength(0);
    // The AQ badge must be the Logo's, which sizes via class, not an inline width.
    const badge = screen.getByText('AQ');
    expect(badge.style.width).toBe('');
  });
});
