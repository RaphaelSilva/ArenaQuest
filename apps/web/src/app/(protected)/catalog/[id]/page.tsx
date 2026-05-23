'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@web/hooks/use-auth';
import { topicsApi, type TopicProgressStatus, type TopicWithMedia } from '@web/lib/topics-api';
import { useTopicsApi } from '@web/lib/api-hooks';
import { TopicHeader } from '@web/components/catalog/TopicHeader';
import { BadgesStrip } from '@web/components/catalog/BadgesStrip';
import { SubtopicCard } from '@web/components/catalog/SubtopicCard';
import { ContentSection } from '@web/components/catalog/ContentSection';
import { MediaGallery } from '@web/components/catalog/MediaGallery';
import { CatalogBreadcrumb } from '@web/components/catalog/CatalogBreadcrumb';
import { Spinner } from '@web/components/spinner';

type CatalogTopicPageProps = {
  params: Promise<{ id: string }>;
};

type BadgeItem = { id: string; emoji: string; name: string; earned: boolean };

export default function CatalogTopicPage({ params }: CatalogTopicPageProps) {
  const { id } = use(params);
  const { accessToken, user } = useAuth();
  const topicsApiHook = useTopicsApi();

  const [topic, setTopic] = useState<TopicWithMedia | null>(null);
  const [progressMap, setProgressMap] = useState<Map<string, TopicProgressStatus>>(new Map());
  const [badges, setBadges] = useState<BadgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const isInstructor = user?.roles.some((r) => r.name === 'instructor' || r.name === 'admin') ?? false;

  // Read instructor preview mode from localStorage
  const [previewRole] = useState<'participant' | 'instructor'>(() => {
    if (typeof window === 'undefined') return 'participant';
    return (localStorage.getItem('aq-catalog-role') as 'participant' | 'instructor') ?? 'participant';
  });
  const showInstructorUI = isInstructor && previewRole === 'instructor';

  useEffect(() => {
    if (!accessToken) return;
    let active = true;

    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

    Promise.all([
      topicsApiHook.getById(id),
      topicsApiHook.listProgress(),
      fetch(`${API_URL}/me/badges`, { headers, cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) return [];
          const body = (await r.json()) as Array<{ badge: { id: string; iconEmoji: string; name: string }; earnedAt: string }>;
          return body.map((e) => ({ id: e.badge.id, emoji: e.badge.iconEmoji, name: e.badge.name, earned: true }));
        })
        .catch(() => [] as BadgeItem[]),
    ]).then(([t, progressEntries, b]) => {
      if (!active) return;
      setTopic(t);
      setProgressMap(new Map(progressEntries.map((p) => [p.topicNodeId, p.status])));
      setBadges(b);
      setLoading(false);
    }).catch((err: unknown) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : 'Failed to load topic');
      setLoading(false);
    });

    return () => { active = false; };
  }, [accessToken, id]);

  if (loading) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error || !topic) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p className="text-sm" style={{ color: 'var(--aq-error)' }}>{error || 'Topic not found'}</p>
      </div>
    );
  }

  // Progress computations
  const subtopicTotal = topic.children.length;
  const subtopicDone = topic.children.filter(
    (c) => (progressMap.get(c.id) ?? 'not_started') === 'completed',
  ).length;
  const pct = subtopicTotal > 0 ? Math.round((subtopicDone / subtopicTotal) * 100) : 0;

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8 md:px-6 lg:px-10">
      {/* Breadcrumb */}
      <CatalogBreadcrumb
        items={[
          { label: 'Catalogue', href: '/catalog' },
          { label: topic.title },
        ]}
        backHref="/catalog"
      />

      {/* Topic header */}
      <TopicHeader topic={topic} pct={pct} />

      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--aq-text2)', fontFamily: "'Space Grotesk', sans-serif" }}>
            Progresso
          </span>
          <strong className="text-[13px]" style={{ color: 'var(--aq-accent)' }}>{pct}%</strong>
        </div>
        <div
          className="overflow-hidden rounded-[10px]"
          style={{ height: 10, background: 'var(--aq-bg3)', border: '1px solid var(--aq-border)' }}
        >
          <div
            className="h-full rounded-[10px] transition-all duration-700"
            style={{
              width: `${pct}%`,
              background: 'linear-gradient(90deg, var(--aq-accent), var(--aq-accent2))',
            }}
          />
        </div>
      </div>

      {/* Badges strip */}
      {badges.length > 0 && <BadgesStrip badges={badges} />}

      {/* Content section */}
      <ContentSection content={topic.content} />

      {/* Media gallery */}
      <MediaGallery media={topic.media || []} />

      {/* Subtopics */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p
            className="text-[13px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--aq-text3)' }}
          >
            Subtopics
          </p>
          {showInstructorUI && (
            <Link
              href="/admin/topics"
              className="flex items-center gap-1.5 rounded-[8px] px-3.5 py-1.5 text-[12px] font-medium transition-all hover:opacity-80"
              style={{
                border: '1px solid var(--aq-accent)',
                background: 'var(--aq-accent-glow)',
                color: 'var(--aq-accent)',
              }}
            >
              + Add subtopic
            </Link>
          )}
        </div>

        {topic.children.length === 0 ? (
          <div
            className="flex flex-col items-center py-16"
            style={{ color: 'var(--aq-text3)' }}
          >
            <p className="text-[40px] opacity-40" aria-hidden>📭</p>
            <p className="mt-3 text-[15px]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>No subtopics yet</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {topic.children.map((child, i) => (
              <SubtopicCard
                key={child.id}
                topicId={id}
                subtopic={child}
                index={i}
                status={progressMap.get(child.id) ?? 'not_started'}
                showInstructorUI={showInstructorUI}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
