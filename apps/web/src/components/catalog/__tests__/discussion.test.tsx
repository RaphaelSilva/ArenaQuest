import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';

const mockListForTopic = vi.fn();
const mockCreateForTopic = vi.fn();
const mockToggleLike = vi.fn();

// Stable client reference — Discussion's useEffect depends on `client`, so a new
// object per render would re-fire the fetch and exhaust the mock.
const mockClient = {
  comments: {
    listForTopic: (...args: unknown[]) => mockListForTopic(...args),
    createForTopic: (...args: unknown[]) => mockCreateForTopic(...args),
    toggleLike: (...args: unknown[]) => mockToggleLike(...args),
  },
};

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => mockClient,
    useAuthContext: () => ({ user: { id: 'me', name: 'Test User' } }),
  };
});

import { Discussion } from '../Discussion';

const COMMENT = {
  id: 'c1',
  userId: 'user123',
  userName: 'Jane Doe',
  body: 'Great content!',
  createdAt: '2026-05-01T10:00:00Z',
  parentCommentId: null,
  likeCount: 2,
  likedByMe: false,
};

describe('Discussion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToggleLike.mockResolvedValue(undefined);
  });

  it('renders the author display name and a like button with its count', async () => {
    mockListForTopic.mockResolvedValue([COMMENT]);

    render(<Discussion topicId="t1" />);

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    const likeBtn = screen.getByRole('button', { name: dictPt.catalog.comments.like });
    expect(likeBtn).toBeInTheDocument();
    expect(likeBtn).toHaveTextContent('2');
    expect(likeBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('optimistically toggles the like and calls the API', async () => {
    mockListForTopic.mockResolvedValue([COMMENT]);

    render(<Discussion topicId="t1" />);

    const likeBtn = await screen.findByRole('button', { name: dictPt.catalog.comments.like });
    fireEvent.click(likeBtn);

    // Optimistic: count bumps to 3 and the button flips to the unlike state
    const unlikeBtn = screen.getByRole('button', { name: dictPt.catalog.comments.unlike });
    expect(unlikeBtn).toHaveTextContent('3');
    expect(unlikeBtn).toHaveAttribute('aria-pressed', 'true');

    await waitFor(() => {
      expect(mockToggleLike).toHaveBeenCalledWith('c1');
    });
  });

  it('rolls back the like on API failure', async () => {
    mockListForTopic.mockResolvedValue([COMMENT]);
    mockToggleLike.mockRejectedValueOnce(new Error('boom'));

    render(<Discussion topicId="t1" />);

    const likeBtn = await screen.findByRole('button', { name: dictPt.catalog.comments.like });
    fireEvent.click(likeBtn);

    // After rollback the original "like" state (count 2, not pressed) is restored
    await waitFor(() => {
      const restored = screen.getByRole('button', { name: dictPt.catalog.comments.like });
      expect(restored).toHaveTextContent('2');
      expect(restored).toHaveAttribute('aria-pressed', 'false');
    });
  });
});
