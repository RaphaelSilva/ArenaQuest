import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dictPt } from '@web/i18n/dict-pt';
import { CommentsApiError } from '@web/lib/comments-api';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const mockCreateForTopic = vi.fn();
const mockToggleLike = vi.fn();
const mockMarkVideoWatched = vi.fn();

vi.mock('@web/context/auth-context', async () => {
  const actual = await vi.importActual('@web/context/auth-context');
  return {
    ...actual,
    useApiClient: () => ({
      comments: {
        createForTopic: (...args: unknown[]) => mockCreateForTopic(...args),
        toggleLike: (...args: unknown[]) => mockToggleLike(...args),
      },
      topics: {
        markVideoWatched: (...args: unknown[]) => mockMarkVideoWatched(...args),
      },
    }),
  };
});

import { MediaTabs } from '../MediaTabs';
import { Comments } from '../Comments';
import type { Media } from '@web/lib/admin-media-api';

const makeMedia = (overrides: Partial<Media>): Media => ({
  id: 'media1',
  topicNodeId: 'topic1',
  url: 'https://example.com/file.mp4',
  type: 'video/mp4',
  storageKey: 'key',
  sizeBytes: 1000000,
  originalName: 'Test Video.mp4',
  uploadedById: 'user1',
  status: 'ready',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const VIDEO: Media = makeMedia({ id: 'v1', type: 'video/mp4', originalName: 'Intro.mp4' });
const FILE: Media = makeMedia({ id: 'f1', type: 'application/pdf', originalName: 'Guide.pdf', url: 'https://example.com/guide.pdf' });
const PHOTO: Media = makeMedia({ id: 'p1', type: 'image/jpeg', originalName: 'photo.jpg' });

describe('MediaTabs', () => {
  it('renders the Videos tab by default when videos exist', () => {
    render(
      <MediaTabs
        videos={[VIDEO]}
        files={[FILE]}
        photos={[PHOTO]}
        topicId="topic1"
      />,
    );
    expect(screen.getByRole('tab', { name: new RegExp(dictPt.catalog.mediaTabs.videos, 'i') })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches to Files tab when clicked', () => {
    render(
      <MediaTabs
        videos={[VIDEO]}
        files={[FILE]}
        photos={[PHOTO]}
        topicId="topic1"
      />,
    );
    const filesTab = screen.getByRole('tab', { name: new RegExp(dictPt.catalog.mediaTabs.files, 'i') });
    fireEvent.click(filesTab);
    expect(filesTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Guide.pdf')).toBeInTheDocument();
  });

  it('preserves video element in DOM when switching tabs (display:none)', () => {
    const { container } = render(
      <MediaTabs
        videos={[VIDEO]}
        files={[FILE]}
        photos={[]}
        topicId="topic1"
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(dictPt.catalog.mediaTabs.files, 'i') }));
    // Video panel still in DOM (display:none) to preserve playback state
    const videoPanel = container.querySelector('#tabpanel-videos');
    expect(videoPanel).toBeInTheDocument();
    expect((videoPanel as HTMLElement).style.display).toBe('none');
  });
});

describe('Comments', () => {
  const INITIAL_COMMENTS = [
    {
      id: 'c1',
      userId: 'user123',
      body: 'Great content!',
      createdAt: '2026-05-01T10:00:00Z',
      likeCount: 3,
      likedByMe: false,
      parentCommentId: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders existing comments', () => {
    render(
      <Comments
        topicId="sub1"
        initialComments={INITIAL_COMMENTS}
      />,
    );
    expect(screen.getByText('Great content!')).toBeInTheDocument();
  });

  it('optimistically prepends a comment on submit', async () => {
    mockCreateForTopic.mockResolvedValueOnce({
      id: 'c2',
      userId: 'me',
      body: 'New comment',
      createdAt: new Date().toISOString(),
      likeCount: 0,
      likedByMe: false,
      parentCommentId: null,
    });

    render(
      <Comments
        topicId="sub1"
        initialComments={[]}
      />,
    );

    const textarea = screen.getByPlaceholderText(new RegExp(dictPt.catalog.comments.placeholder.slice(0, 12), 'i'));
    fireEvent.change(textarea, { target: { value: 'New comment' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(dictPt.catalog.comments.submit, 'i') });
    fireEvent.click(submitBtn);

    // Optimistic comment should appear immediately
    expect(screen.getByText('New comment')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockCreateForTopic).toHaveBeenCalledWith('sub1', 'New comment');
    });
  });

  it('rolls back optimistic comment on API failure and shows error', async () => {
    mockCreateForTopic.mockRejectedValueOnce(
      new CommentsApiError('Unknown', 500, 'Failed (500)'),
    );

    render(
      <Comments
        topicId="sub1"
        initialComments={[]}
      />,
    );

    const textarea = screen.getByPlaceholderText(new RegExp(dictPt.catalog.comments.placeholder.slice(0, 12), 'i'));
    fireEvent.change(textarea, { target: { value: 'Will fail' } });

    const submitBtn = screen.getByRole('button', { name: new RegExp(dictPt.catalog.comments.submit, 'i') });
    fireEvent.click(submitBtn);

    // After rollback an error message appears
    await waitFor(() => {
      expect(screen.getByText(/failed/i)).toBeInTheDocument();
    }, { timeout: 3000 });

    // After rollback, comments list is empty again (header shows 0 comments)
    expect(screen.getByText(dictPt.catalog.comments.header(0))).toBeInTheDocument();
  });
});
