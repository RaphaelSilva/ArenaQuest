'use client';

import React, { useState, useEffect } from 'react';
import { useDict } from '@web/context/dict-context';
import { useApiClient } from '@web/context/auth-context';
import { SectionEmpty } from './SectionEmpty';
import { SectionError } from './SectionError';

type Comment = {
  id: string;
  userId: string;
  body: string | null;
  createdAt: string;
  parentCommentId: string | null;
};

type Props = {
  topicId: string;
};

function formatCommentTime(iso: string, fallback: string): string {
  try {
    const diffMin = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    return new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' }).format(
      diffMin,
      'minute',
    );
  } catch {
    return fallback;
  }
}

export function Discussion({ topicId }: Props) {
  const dict = useDict();
  const client = useApiClient();

  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Fetch comments
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);

    client.comments.listForTopic(topicId)
      .then((data) => {
        if (active) {
          setComments(data.filter((c) => c.parentCommentId === null && c.body !== null));
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [topicId, client]);

  const handleSubmit = async () => {
    const body = text.trim();
    if (!body || submitting) return;

    setSubmitting(true);
    setSubmitError('');

    const optimisticId = `optimistic-${Date.now()}`;
    const optimistic: Comment = {
      id: optimisticId,
      userId: 'me',
      body,
      createdAt: new Date().toISOString(),
      parentCommentId: null,
    };

    // Optimistic update
    setComments((prev) => [optimistic, ...prev]);
    setText('');

    try {
      const realComment = await client.comments.createForTopic(topicId, body);

      setComments((prev) =>
        prev.map((c) => (c.id === optimisticId ? realComment : c)),
      );
    } catch {
      // Rollback optimistic update
      setComments((prev) => prev.filter((c) => c.id !== optimisticId));
      setText(body);
      setSubmitError(dict.catalog.redesign.sectionError);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--aq-accent)] border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return <SectionError message={dict.catalog.redesign.sectionError} />;
  }

  return (
    <section className="mb-8">
      <h2
        className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
        style={{ color: 'var(--aq-text3)' }}
      >
        {dict.catalog.redesign.sectionDiscussion}
      </h2>

      {/* Composer */}
      <div
        className="mb-6 rounded-[14px] border p-4 transition-all duration-200 focus-within:border-[var(--aq-accent)]"
        style={{
          borderColor: 'var(--aq-border)',
          background: 'var(--aq-bg2)',
          boxShadow: 'var(--aq-card-shadow, 0 2px 12px rgba(0,0,0,0.15))',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
            style={{
              background: 'linear-gradient(135deg, var(--aq-accent), var(--aq-accent2))',
              color: '#0b0e17',
            }}
            aria-hidden
          >
            ME
          </div>
          <div className="flex-1 min-w-0">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  void handleSubmit();
                }
              }}
              placeholder={dict.catalog.redesign.discussionPlaceholder}
              rows={2}
              className="w-full bg-transparent text-[14px] outline-none placeholder-[var(--aq-text3)] text-[var(--aq-text)] resize-none"
              style={{ fontFamily: 'inherit' }}
              disabled={submitting}
            />

            {/* Publish Actions panel */}
            {text.trim() && (
              <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--aq-border2)' }}>
                {submitError ? (
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--aq-error)' }}>
                    {submitError}
                  </span>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="rounded-[8px] bg-[var(--aq-accent)] px-4 py-1.5 text-[12px] font-bold text-[#0b0e17] hover:scale-[1.03] active:scale-[0.98] transition-all disabled:opacity-60 cursor-pointer"
                >
                  {dict.catalog.redesign.discussionPublish}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Comment List */}
      <div className="flex flex-col gap-3">
        {comments.length === 0 ? (
          <SectionEmpty
            title={dict.catalog.redesign.emptyDiscussion}
            description={dict.catalog.redesign.discussionEmptyNudge}
            icon="💬"
          />
        ) : (
          comments.map((c) => {
            const isMe = c.userId === 'me';
            const initials = isMe ? 'ME' : c.userId.slice(0, 2).toUpperCase();

            return (
              <div
                key={c.id}
                className="flex gap-3 rounded-[12px] border p-4 transition-all duration-200 hover:border-[var(--aq-border2)]"
                style={{
                  borderColor: 'var(--aq-border)',
                  background: 'var(--aq-bg2)',
                }}
              >
                <div
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-bold uppercase"
                  style={{
                    background: 'var(--aq-bg3)',
                    color: 'var(--aq-accent)',
                    border: '1px solid var(--aq-border2)',
                  }}
                  aria-hidden
                >
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="truncate text-[13px] font-bold"
                      style={{
                        fontFamily: 'var(--font-space-grotesk), sans-serif',
                        color: isMe ? 'var(--aq-accent)' : 'var(--aq-text)',
                      }}
                    >
                      {isMe ? 'You' : `User (${c.userId.slice(0, 5)})`}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--aq-text3)' }}>
                      {formatCommentTime(c.createdAt, 'now')}
                    </span>
                  </div>
                  <p
                    className="mt-1.5 text-[13.5px] leading-relaxed break-words"
                    style={{ color: 'var(--aq-text2)' }}
                  >
                    {c.body}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
