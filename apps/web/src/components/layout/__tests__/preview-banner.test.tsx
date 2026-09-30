import { render, screen } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { PreviewBanner } from '../preview-banner';

const t = dictPt.previewBanner;
const KEYS = ['NEXT_PUBLIC_PREVIEW_NAME', 'NEXT_PUBLIC_PREVIEW_SHA'] as const;
const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe('PreviewBanner', () => {
  it('shows the candidate name and short sha from the dictionary when set', () => {
    process.env.NEXT_PUBLIC_PREVIEW_NAME = 'm21';
    process.env.NEXT_PUBLIC_PREVIEW_SHA = 'abc1234';
    render(<PreviewBanner />);

    expect(screen.getByText(t.label('m21', 'abc1234'))).toBeInTheDocument();
    expect(screen.getByText(t.label('m21', 'abc1234')).textContent).toBe('Prévia m21 · abc1234');
    expect(screen.getByText(t.sharedData)).toBeInTheDocument();
  });

  it('omits the sha separator when only the name is set', () => {
    process.env.NEXT_PUBLIC_PREVIEW_NAME = 'm21';
    delete process.env.NEXT_PUBLIC_PREVIEW_SHA;
    render(<PreviewBanner />);

    expect(screen.getByText(t.label('m21'))).toBeInTheDocument();
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it('renders nothing at all when the preview name is unset', () => {
    delete process.env.NEXT_PUBLIC_PREVIEW_NAME;
    process.env.NEXT_PUBLIC_PREVIEW_SHA = 'abc1234';
    const { container } = render(<PreviewBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the preview name is blank', () => {
    process.env.NEXT_PUBLIC_PREVIEW_NAME = '  ';
    const { container } = render(<PreviewBanner />);

    expect(container).toBeEmptyDOMElement();
  });
});
