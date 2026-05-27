'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { renderMarkdown } from '@arenaquest/shared/utils/sanitize-markdown';
import { useAuth } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import type { TopicNode, TopicProgressStatus } from '@web/lib/topics-api';
import { MediaTabs } from '@web/components/catalog/MediaTabs';
import { Comments } from '@web/components/catalog/Comments';
import { SubtopicSidebar } from '@web/components/catalog/SubtopicSidebar';
import { CatalogBreadcrumb } from '@web/components/catalog/CatalogBreadcrumb';
import { Spinner } from '@web/components/spinner';
import type { Media } from '@web/lib/admin-media-api';
import { useDict } from '@web/context/dict-context';

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
  const dict = useDict();
  const { id: topicId, subtopicId } = use(params);
  const { accessToken } = useAuth();
  const client = useApiClient();

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
    let active = true;

    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

    Promise.all([
      client.topics.getById(topicId),
      client.topics.getById(subtopicId),
      client.topics.listProgress(),
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
      setError(err instanceof Error ? err.message : dict.catalog.subtopicPage.errorLoading);
      setLoading(false);
    });

    return () => { active = false; };
  }, [client, accessToken, topicId, subtopicId, API_URL, dict.catalog.subtopicPage.errorLoading]);

  async function handleMarkDone() {
    if (markingDone || status === 'completed') return;
    setMarkingDone(true);
    try {
      const newStatus = await client.topics.complete(subtopicId);
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
        <p className="text-sm" style={{ color: 'var(--aq-error)' }}>{error || dict.catalog.subtopicPage.errorNotFound}</p>
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

  const currentIndex = siblings.findIndex((s) => s.id === subtopicId);
  const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const next = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Main content */}
      <div className="flex-1 overflow-y-auto" style={{ width: '100%' }}>
        <div className="mx-auto max-w-[900px] px-4 py-8 md:px-6 lg:px-10">
        {/* Breadcrumb */}
        <CatalogBreadcrumb
          items={[
            { label: dict.catalog.breadcrumb.catalogue, href: '/catalog' },
            { label: parentTopic.title, href: `/catalog/${topicId}` },
            { label: subtopic.title },
          ]}
          backHref={`/catalog/${topicId}`}
        />

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
                {dict.catalog.subtopicPage.subtopicOf(siblingIndex + 1, siblings.length)}
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
                📦 {dict.catalog.subtopicPage.itemCount(readyMedia.length)}
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
              {dict.catalog.subtopicPage.completedLabel}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleMarkDone()}
              disabled={markingDone}
              className="flex-shrink-0 rounded-[8px] px-4 py-2 text-[12px] font-semibold transition-opacity disabled:opacity-60"
              style={{ background: 'var(--aq-accent)', color: '#0B0E17' }}
            >
              {markingDone ? dict.catalog.subtopicPage.markingDone : dict.catalog.subtopicPage.markDoneButton}
            </button>
          )}
        </div>

        <div className="mb-8 h-[1px]" style={{ background: 'var(--aq-border)' }} />

        {/* Media section */}
        {readyMedia.length > 0 && (
          <div className="mb-8">
            <p className="mb-4 text-[13px] font-semibold uppercase tracking-widest" style={{ color: 'var(--aq-text3)' }}>
              {dict.catalog.subtopicPage.materialTitle}
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
              className="prose prose-sm dark:prose-invert max-w-none rounded-[14px] p-6"
              style={{
                background: 'var(--aq-bg2)',
                border: '1px solid var(--aq-border)',
                color: 'var(--aq-text2)',
                '--tw-prose-body': 'var(--aq-text2)',
                '--tw-prose-headings': 'var(--aq-text1)',
                '--tw-prose-links': 'var(--aq-accent)',
                '--tw-prose-code': 'var(--aq-accent)',
                '--tw-prose-hr': 'var(--aq-border)',
              } as React.CSSProperties}
            >
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(subtopic.content) }} />
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

        {/* Children list — if subtopic has children */}
        {subtopic.children.length > 0 && (
          <div className="mt-12">
            <div className="mb-4 h-[1px]" style={{ background: 'var(--aq-border)' }} />
            <p className="mb-4 text-[13px] font-semibold uppercase tracking-widest" style={{ color: 'var(--aq-text3)' }}>
              {dict.catalog.subtopicPage.nextTopicsTitle}
            </p>
            <div className="space-y-2">
              {subtopic.children.map((child, i) => {
                const childStatus = progressMap.get(child.id) ?? 'not_started';
                return (
                  <Link
                    key={child.id}
                    href={`/catalog/${topicId}/${child.id}`}
                    className="flex items-center gap-3 rounded-[8px] border px-4 py-3 transition-colors hover:bg-[var(--aq-bg3)]"
                    style={{
                      borderColor: 'var(--aq-border)',
                      background: 'var(--aq-bg2)',
                    }}
                  >
                    <div
                      className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[8px] text-[12px] font-bold"
                      style={
                        childStatus === 'completed'
                          ? { background: 'var(--aq-accent3)', color: 'white' }
                          : { background: 'var(--aq-bg3)', color: 'var(--aq-text3)', border: '1px solid var(--aq-border2)' }
                      }
                    >
                      {childStatus === 'completed' ? '✓' : i + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]" style={{ color: 'var(--aq-text)' }}>
                        {child.title}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Mobile bottom navigation — visible only on md and below */}
        <div className="mt-12 block md:hidden">
          <div className="mb-4 h-[1px]" style={{ background: 'var(--aq-border)' }} />
          <div className="flex gap-2">
            {prev ? (
              <Link
                href={`/catalog/${topicId}/${prev.id}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-[12px] font-medium transition-colors hover:bg-[var(--aq-bg3)]"
                style={{ border: '1px solid var(--aq-border2)', color: 'var(--aq-text2)' }}
              >
                {dict.catalog.subtopicPage.previous}
              </Link>
            ) : (
              <div className="flex-1" />
            )}
            {next ? (
              <Link
                href={`/catalog/${topicId}/${next.id}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-[12px] font-medium transition-colors hover:bg-[var(--aq-bg3)]"
                style={{ border: '1px solid var(--aq-border2)', color: 'var(--aq-text2)' }}
              >
                {dict.catalog.subtopicPage.next}
              </Link>
            ) : (
              <Link
                href={`/catalog/${topicId}`}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] py-2 text-[12px] font-medium transition-colors"
                style={{ background: 'var(--aq-accent-glow)', border: '1px solid var(--aq-accent)', color: 'var(--aq-accent)' }}
              >
                {dict.catalog.subtopicPage.completedNav}
              </Link>
            )}
          </div>
        </div>
        </div>
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
