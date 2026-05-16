'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@web/hooks/use-auth';
import { topicsApi, type TopicNode, type TopicProgressStatus } from '@web/lib/topics-api';
import { MediaTabs } from '@web/components/catalog/MediaTabs';
import { Comments } from '@web/components/catalog/Comments';
import { SubtopicSidebar } from '@web/components/catalog/SubtopicSidebar';
import { Spinner } from '@web/components/spinner';
import type { Media } from '@web/lib/admin-media-api';

type PageProps = { params: Promise<{ id: string; subtopicId: string }> };

type CommentWithMeta = {
  id: string;
  userId: string;
  body: string | null;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  parentCommentId: string | null;
};

export default function SubtopicDetailPage({ params }: PageProps) {
  const { id: topicId, subtopicId } = use(params);
  const { accessToken } = useAuth();

  const [parentTopic, setParentTopic] = useState<(TopicNode & { children: TopicNode[] }) | null>(null);
  const [subtopic, setSubtopic] = useState<(TopicNode & { children: TopicNode[] }) | null>(null);
  const [progressMap, setProgressMap] = useState<Map<string, TopicProgressStatus>>(new Map());
  const [comments, setComments] = useState<CommentWithMeta[]>([]);
  const [status, setStatus] = useState<TopicProgressStatus>('not_started');
  const [markingDone, setMarkingDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

  useEffect(() => {
    if (!accessToken) return;
    let active = true;

    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

    Promise.all([
      topicsApi.getById(accessToken, topicId),
      topicsApi.getById(accessToken, subtopicId),
      topicsApi.listProgress(accessToken),
      fetch(`${API_URL}/topics/${subtopicId}/comments`, { headers, cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) return [];
          const body = (await r.json()) as { data: CommentWithMeta[] };
          return body.data;
        })
        .catch(() => [] as CommentWithMeta[]),
    ]).then(([parent, sub, progress, cmts]) => {
      if (!active) return;
      setParentTopic(parent);
      setSubtopic(sub);
      const map = new Map<string, TopicProgressStatus>(progress.map((p) => [p.topicNodeId, p.status]));
      setProgressMap(map);
      setStatus(map.get(subtopicId) ?? 'not_started');
      setComments(cmts);
      setLoading(false);
    }).catch((err: unknown) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : 'Failed to load subtopic');
      setLoading(false);
    });

    return () => { active = false; };
  }, [accessToken, topicId, subtopicId, API_URL]);

  async function handleMarkDone() {
    if (!accessToken || markingDone || status === 'completed') return;
    setMarkingDone(true);
    try {
      const newStatus = await topicsApi.complete(accessToken, subtopicId);
      setStatus(newStatus);
      setProgressMap((prev) => new Map(prev).set(subtopicId, newStatus));
    } finally {
      setMarkingDone(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error || !subtopic || !parentTopic) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center p-8 text-center">
        <p className="text-sm" style={{ color: 'var(--aq-error)' }}>{error || 'Subtopic not found'}</p>
      </div>
    );
  }

  const readyMedia: Media[] = (subtopic.media ?? []).filter((m) => m.status === 'ready');
  const videos = readyMedia.filter((m) => m.type.startsWith('video/'));
  const files = readyMedia.filter((m) => !m.type.startsWith('video/') && !m.type.startsWith('image/'));
  const photos = readyMedia.filter((m) => m.type.startsWith('image/'));

  const siblings = parentTopic.children;
  const siblingIndex = siblings.findIndex((s) => s.id === subtopicId);
  const progressPct = status === 'completed' ? 100 : status === 'in_progress' ? 35 : 0;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto" style={{ padding: '32px 40px 48px' }}>
        {/* Breadcrumb */}
        <nav className="mb-5 flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: 'var(--aq-text3)' }}>
          <Link href="/catalog" className="transition-colors hover:text-[var(--aq-accent)]" style={{ color: 'var(--aq-text3)' }}>
            Catalogue
          </Link>
          <span>›</span>
          <Link href={`/catalog/${topicId}`} className="transition-colors hover:text-[var(--aq-accent)]" style={{ color: 'var(--aq-text3)' }}>
            {parentTopic.title}
          </Link>
          <span>›</span>
          <span className="font-medium" style={{ color: 'var(--aq-text2)' }}>{subtopic.title}</span>
        </nav>

        {/* Header */}
        <div className="mb-6">
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            {/* Parent topic pill */}
            <span
              className="flex items-center gap-1.5 rounded-[20px] px-2.5 py-1 text-[11px] font-semibold"
              style={{
                background: 'oklch(0.74 0.19 52 / 0.12)',
                border: '1px solid oklch(0.74 0.19 52 / 0.25)',
                color: 'var(--aq-accent)',
              }}
            >
              📚 {parentTopic.title}
            </span>
            {siblingIndex >= 0 && (
              <span className="text-[11px]" style={{ color: 'var(--aq-text3)' }}>
                Subtópico {siblingIndex + 1} de {siblings.length}
              </span>
            )}
          </div>

          <h1
            className="mb-3 text-[28px] font-bold tracking-tight"
            style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.4px' }}
          >
            {subtopic.title}
          </h1>

          <div className="flex flex-wrap items-center gap-2">
            {subtopic.estimatedMinutes > 0 && (
              <span
                className="flex items-center gap-1 rounded-[20px] px-2.5 py-1 text-[11px] font-medium"
                style={{ background: 'var(--aq-bg3)', border: '1px solid var(--aq-border2)', color: 'var(--aq-text2)' }}
              >
                🕒 {subtopic.estimatedMinutes} min
              </span>
            )}
            {readyMedia.length > 0 && (
              <span
                className="flex items-center gap-1 rounded-[20px] px-2.5 py-1 text-[11px] font-medium"
                style={{ background: 'var(--aq-bg3)', border: '1px solid var(--aq-border2)', color: 'var(--aq-text2)' }}
              >
                📦 {readyMedia.length} {readyMedia.length === 1 ? 'item' : 'itens'}
              </span>
            )}
            {subtopic.tags?.map((t) => (
              <span
                key={t.id}
                className="rounded-[20px] px-2.5 py-1 text-[11px] font-medium"
                style={{ background: 'var(--aq-bg4)', color: 'var(--aq-text3)' }}
              >
                {t.name}
              </span>
            ))}
          </div>
        </div>

        {/* Progress row */}
        <div className="mb-8 flex items-center gap-4">
          <div
            className="flex-1 overflow-hidden rounded-full"
            style={{ height: 8, background: 'var(--aq-bg3)' }}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progressPct}%`,
                background: status === 'completed' ? 'var(--aq-accent3)' : 'var(--aq-accent)',
              }}
            />
          </div>
          <span className="flex-shrink-0 text-[12px] font-semibold" style={{ color: 'var(--aq-accent)' }}>
            {progressPct}%
          </span>
          {status === 'completed' ? (
            <span
              className="flex-shrink-0 rounded-[8px] px-4 py-2 text-[12px] font-semibold"
              style={{ background: 'var(--aq-accent3-glow)', color: 'var(--aq-accent3)' }}
            >
              ✓ Concluído
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleMarkDone()}
              disabled={markingDone}
              className="flex-shrink-0 rounded-[8px] px-4 py-2 text-[12px] font-semibold transition-opacity disabled:opacity-60"
              style={{ background: 'var(--aq-accent)', color: '#0B0E17' }}
            >
              {markingDone ? 'Registrando…' : 'Marcar como concluído'}
            </button>
          )}
        </div>

        <div className="mb-8 h-[1px]" style={{ background: 'var(--aq-border)' }} />

        {/* Media section */}
        {readyMedia.length > 0 && (
          <div className="mb-8">
            <p className="mb-4 text-[13px] font-semibold uppercase tracking-widest" style={{ color: 'var(--aq-text3)' }}>
              Material do Subtópico
            </p>
            <MediaTabs
              videos={videos}
              files={files}
              photos={photos}
              topicId={topicId}
              accessToken={accessToken ?? ''}
            />
          </div>
        )}

        {/* Markdown content */}
        {subtopic.content && (
          <div className="mb-8">
            <div className="mb-8 h-[1px]" style={{ background: 'var(--aq-border)' }} />
            <div
              className="prose max-w-none rounded-[14px] p-6"
              style={{ background: 'var(--aq-bg2)', border: '1px solid var(--aq-border)', color: 'var(--aq-text2)' }}
            >
              <pre className="whitespace-pre-wrap text-[13px] leading-relaxed">{subtopic.content}</pre>
            </div>
          </div>
        )}

        <div className="mb-8 h-[1px]" style={{ background: 'var(--aq-border)' }} />

        {/* Comments */}
        <Comments
          topicId={subtopicId}
          initialComments={comments}
          accessToken={accessToken ?? ''}
        />
      </div>

      {/* Right sidebar */}
      <SubtopicSidebar
        topicId={topicId}
        topicTitle={parentTopic.title}
        subtopicId={subtopicId}
        siblings={siblings}
        progressMap={progressMap}
      />
    </div>
  );
}
