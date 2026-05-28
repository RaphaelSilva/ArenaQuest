'use client';

export const runtime = 'edge';

import { use, useMemo, useEffect, useState } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import type { TopicProgressStatus, TopicWithMedia, TopicNode } from '@web/lib/topics-api';
import { buildTrail, countDeep } from '@web/lib/topic-tree';
import { TopicHeader } from '@web/components/catalog/TopicHeader';
import { BadgesStrip } from '@web/components/catalog/BadgesStrip';
import { SubtopicCard } from '@web/components/catalog/SubtopicCard';
import { ContentSection } from '@web/components/catalog/ContentSection';
import { SectionEmpty } from '@web/components/catalog/SectionEmpty';
import { MediaList } from '@web/components/catalog/MediaList/MediaList';
import { CatalogBreadcrumb } from '@web/components/catalog/CatalogBreadcrumb';
import { useDict } from '@web/context/dict-context';
import { MainPaneSkeleton } from '@web/components/catalog/MainPaneSkeleton';

type CatalogTopicPageProps = {
  params: Promise<{ id: string }>;
};

type BadgeItem = { id: string; emoji: string; name: string; earned: boolean };

export default function CatalogTopicPage({ params }: CatalogTopicPageProps) {
  const dict = useDict();
  const { id } = use(params);
  const { accessToken } = useAuth();
  const client = useApiClient();

  const [topic, setTopic] = useState<TopicWithMedia | null>(null);
  const [allTopics, setAllTopics] = useState<TopicNode[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, TopicProgressStatus>>(new Map());
  const [badges, setBadges] = useState<BadgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const trail = useMemo(() => (topic ? buildTrail(allTopics, id) : []), [allTopics, id, topic]);
  const totalInBranch = useMemo(() => (topic ? countDeep(allTopics, id) : 0), [allTopics, id, topic]);

  const breadcrumbItems = useMemo(() => {
    const list: Array<{ label: string; href?: string }> = [{ label: dict.catalog.breadcrumb.catalogue, href: '/catalog' }];
    trail.forEach((t, i) => {
      const isLast = i === trail.length - 1;
      list.push({
        label: t.title,
        href: isLast ? undefined : `/catalog/${t.id}`,
      });
    });
    return list;
  }, [trail, dict]);


  useEffect(() => {
    let active = true;

    const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };

    Promise.all([
      client.topics.getById(id),
      client.topics.list(),
      client.topics.listProgress(),
      fetch(`${API_URL}/me/badges`, { headers, cache: 'no-store' })
        .then(async (r) => {
          if (!r.ok) return [];
          const body = (await r.json()) as Array<{ badge: { id: string; iconEmoji: string; name: string }; earnedAt: string }>;
          return body.map((e) => ({ id: e.badge.id, emoji: e.badge.iconEmoji, name: e.badge.name, earned: true }));
        })
        .catch(() => [] as BadgeItem[]),
    ]).then(([t, allTopicsData, progressEntries, b]) => {
      if (!active) return;
      setTopic(t);
      setAllTopics(allTopicsData);
      setProgressMap(new Map(progressEntries.map((p) => [p.topicNodeId, p.status])));
      setBadges(b);
      setLoading(false);
    }).catch((err: unknown) => {
      if (!active) return;
      setError(err instanceof Error ? err.message : dict.catalog.topicPage.errorNotFound);
      setLoading(false);
    });

    return () => { active = false; };
  }, [client, accessToken, id, dict.catalog.topicPage.errorNotFound]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[900px] px-4 py-8 md:px-6 lg:px-10">
        <MainPaneSkeleton />
      </div>
    );
  }

  if (error || !topic) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <p className="text-sm" style={{ color: 'var(--aq-error)' }}>{error || dict.catalog.topicPage.errorNotFound}</p>
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
        items={breadcrumbItems}
        backHref="/catalog"
      />

      {/* Topic header */}
      <TopicHeader topic={topic} trail={trail} totalInBranch={totalInBranch} />

      {/* Progress bar */}
      <div className="mb-8">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="text-[13px] font-semibold" style={{ color: 'var(--aq-text2)', fontFamily: "'Space Grotesk', sans-serif" }}>
            {dict.catalog.topicPage.progress}
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
      {(!topic.content || !topic.content.trim()) ? (
        <section className="mb-8">
          <h2
            className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--aq-text3)' }}
          >
            {dict.catalog.topicPage.contentTitle}
          </h2>
          <SectionEmpty title={dict.catalog.redesign.emptyDescription} />
        </section>
      ) : (
        <ContentSection content={topic.content} />
      )}

      {/* Media section */}
      {(!topic.media || topic.media.length === 0) ? (
        <section className="mb-8">
          <h2
            className="mb-4 text-[13px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--aq-text3)' }}
          >
            {dict.catalog.topicPage.mediaGalleryTitle}
          </h2>
          <SectionEmpty title={dict.catalog.redesign.emptyMedia} />
        </section>
      ) : (
        <MediaList
          media={topic.media}
          onVisitTopic={() => client.topics.visit(id)}
        />
      )}

      {/* Subtopics */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <p
            className="text-[13px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--aq-text3)' }}
          >
            {dict.catalog.topicPage.subtopics}
          </p>
        </div>

        {topic.children.length === 0 ? (
          <div
            className="flex flex-col items-center py-16"
            style={{ color: 'var(--aq-text3)' }}
          >
            <p className="text-[40px] opacity-40" aria-hidden>📭</p>
            <p className="mt-3 text-[15px]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>{dict.catalog.topicPage.noSubtopics}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {topic.children.map((child, i) => (
              <SubtopicCard
                key={child.id}
                topicId={id}
                subtopic={child}
                index={i}
                status={progressMap.get(child.id) ?? 'not_started'}
                hasChildren={allTopics.some((t) => t.parentId === child.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
