'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@web/hooks/use-auth';
import { type TopicNode, type TopicProgressStatus } from '@web/lib/topics-api';
import { useTopicsApi } from '@web/lib/api-hooks';
import { CatalogBreadcrumb } from '@web/components/catalog/CatalogBreadcrumb';
import { Spinner } from '@web/components/spinner';

export default function CatalogIndexPage() {
  const { accessToken } = useAuth();
  const topicsApiHook = useTopicsApi();
  const [topics, setTopics] = useState<TopicNode[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, TopicProgressStatus>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;

    Promise.all([
      topicsApiHook.list(),
      topicsApiHook.listProgress(),
    ]).then(([nodes, progressEntries]) => {
      if (!active) return;
      // Filter to root topics only (parentId === null)
      setTopics(nodes.filter((n) => n.parentId === null));
      const map = new Map<string, TopicProgressStatus>(
        progressEntries.map((p) => [p.topicNodeId, p.status]),
      );
      setProgressMap(map);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoading(false);
    });

    return () => { active = false; };
  }, [accessToken]);

  return (
    <div className="mx-auto max-w-[900px] px-4 py-8 md:px-6 lg:px-10">
      {/* Breadcrumb */}
      <CatalogBreadcrumb items={[{ label: 'Catalogue' }]} />

      <h1 className="mb-8 text-2xl font-bold md:text-3xl" style={{ color: 'var(--aq-text)' }}>
        Catalogue
      </h1>

      {loading ? (
        <div className="flex h-[200px] items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : topics.length === 0 ? (
        <div className="flex h-[200px] flex-col items-center justify-center text-center">
          <p style={{ color: 'var(--aq-text3)' }}>No topics available yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {topics.map((topic) => {
            const status = progressMap.get(topic.id) ?? 'not_started';
            const pct = status === 'completed' ? 100 : status === 'in_progress' ? 50 : 0;
            return (
              <Link
                key={topic.id}
                href={`/catalog/${topic.id}`}
                className="block rounded-[8px] border px-4 py-3 transition-colors hover:bg-[var(--aq-bg3)]"
                style={{
                  borderColor: 'var(--aq-border)',
                  background: 'var(--aq-bg2)',
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[16px]">📚</span>
                      <h3 className="truncate font-semibold" style={{ color: 'var(--aq-text)' }}>
                        {topic.title}
                      </h3>
                      {status === 'completed' && (
                        <span className="text-sm font-semibold" style={{ color: 'var(--aq-accent3)' }}>
                          ✓
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div
                        className="h-[4px] flex-1 overflow-hidden rounded-full"
                        style={{ background: 'var(--aq-bg4)' }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            background:
                              status === 'completed'
                                ? 'var(--aq-accent3)'
                                : 'var(--aq-accent)',
                          }}
                        />
                      </div>
                      <span className="flex-shrink-0 text-[11px] font-semibold" style={{ color: 'var(--aq-text3)' }}>
                        {pct}%
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
