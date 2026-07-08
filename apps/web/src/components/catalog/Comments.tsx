'use client';

import { useState } from 'react';
import { useDict } from '@web/context/dict-context';
import { useApiClient, useAuthContext } from '@web/context/auth-context';

type CommentWithMeta = {
  id: string;
  userId: string;
  userName: string;
  body: string | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  parentCommentId: string | null;
};

type Props = {
  topicId: string;
  initialComments: CommentWithMeta[];
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatTime(iso: string, now: string): string {
  try {
    return new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' }).format(
      Math.round((new Date(iso).getTime() - Date.now()) / 60000),
      'minute',
    );
  } catch {
    return now;
  }
}

export function Comments({ topicId, initialComments }: Props) {
  const dict = useDict();
  const client = useApiClient();
  const { user } = useAuthContext();
  const [comments, setComments] = useState<CommentWithMeta[]>(
    initialComments.filter((c) => c.parentCommentId === null && c.body !== null),
  );
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  async function handleSubmit() {
    const body = text.trim();
    if (!body || submitting) return;

    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: CommentWithMeta = {
      id: optimisticId,
      userId: 'me',
      userName: user?.name ?? '',
      body,
      createdAt: new Date().toISOString(),
      likeCount: 0,
      likedByMe: false,
      parentCommentId: null,
    };

    setComments((prev) => [optimistic, ...prev]);
    setText('');
    setSubmitting(true);
    setSubmitError('');

    try {
      const real = await client.comments.createForTopic(topicId, body);
      setComments((prev) => prev.map((c) => (c.id === optimisticId ? real : c)));
    } catch (err) {
      setComments((prev) => prev.filter((c) => c.id !== optimisticId));
      setText(body);
      setSubmitError(err instanceof Error ? err.message : 'Failed to post comment');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLike(commentId: string) {
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? { ...c, likedByMe: !c.likedByMe, likeCount: c.likedByMe ? c.likeCount - 1 : c.likeCount + 1 }
          : c,
      ),
    );
    try {
      await client.comments.toggleLike(commentId);
    } catch {
      // rollback
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, likedByMe: !c.likedByMe, likeCount: c.likedByMe ? c.likeCount - 1 : c.likeCount + 1 }
            : c,
        ),
      );
    }
  }

  return (
    <div>
      <p
        className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {dict.catalog.comments.header(comments.length)}
      </p>

      {/* Comment input */}
      <div className="mb-6 flex gap-3">
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
          style={{ background: 'var(--aq-accent)', color: '#0B0E17' }}
          aria-hidden
        >
          U
        </div>
        <div className="flex-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSubmit(); }}
            placeholder={dict.catalog.comments.placeholder}
            rows={2}
            className="w-full rounded-[10px] px-3 py-2 text-[13px] outline-none transition-all"
            style={{
              background: 'var(--aq-bg3)',
              border: '1px solid var(--aq-border2)',
              color: 'var(--aq-text)',
              resize: 'none',
            } as React.CSSProperties}
            disabled={submitting}
          />
          {text && (
            <div className="mt-2 flex items-center justify-between">
              {submitError && (
                <span className="text-[11px]" style={{ color: 'var(--aq-error)' }}>{submitError}</span>
              )}
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={submitting}
                className="ml-auto rounded-[8px] px-4 py-1.5 text-[12px] font-medium transition-opacity disabled:opacity-60"
                style={{ background: 'var(--aq-accent)', color: '#0B0E17' }}
              >
                {submitting ? dict.catalog.comments.submitting : dict.catalog.comments.submit}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Comments list */}
      <div className="flex flex-col gap-4">
        {comments.length === 0 && (
          <p className="py-6 text-center text-[13px]" style={{ color: 'var(--aq-text3)' }}>
            {dict.catalog.comments.empty}
          </p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="flex gap-3">
            <div
              className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase"
              style={{ background: 'var(--aq-bg3)', color: 'var(--aq-accent)', border: '1px solid var(--aq-border2)' }}
              aria-hidden
            >
              {initials(c.userId === 'me' ? (user?.name ?? '') : c.userName)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold" style={{ color: 'var(--aq-text)' }}>
                  {c.userId === 'me'
                    ? dict.catalog.comments.you
                    : c.userName || dict.catalog.comments.anonymous}
                </span>
                <span className="text-[11px]" style={{ color: 'var(--aq-text3)' }}>
                  {formatTime(c.createdAt, dict.catalog.comments.now)}
                </span>
              </div>
              <p className="mt-1 text-[13px] leading-relaxed" style={{ color: 'var(--aq-text2)' }}>
                {c.body}
              </p>
              <button
                type="button"
                onClick={() => void handleLike(c.id)}
                className="mt-1.5 flex items-center gap-1 text-[11px] transition-colors"
                style={{ color: c.likedByMe ? 'var(--aq-accent)' : 'var(--aq-text3)' }}
              >
                ♥ {c.likeCount > 0 && c.likeCount}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
