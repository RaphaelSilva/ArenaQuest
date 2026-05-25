'use client';

import { Suspense, useEffect, useState } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { useApiClient } from '@web/context/auth-context';
import type { TopicNode, TopicProgressEntry, TopicProgressStatus } from '@web/lib/topics-api';
import { CatalogSidebar } from '@web/components/catalog/CatalogSidebar';
import { MobileSearchBar } from '@web/components/catalog/MobileSearchBar';

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-5" aria-hidden>
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-9 animate-pulse rounded-lg"
          style={{ background: 'var(--aq-bg3)', width: `${70 + i * 5}%` }}
        />
      ))}
    </div>
  );
}

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const client = useApiClient();
  const [topics, setTopics] = useState<TopicNode[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, TopicProgressStatus>>(new Map());
  const [globalProgress, setGlobalProgress] = useState(0);

  const isInstructor =
    user?.roles.some((r) => r.name === 'instructor' || r.name === 'admin') ?? false;

  useEffect(() => {
    let active = true;

    Promise.all([client.topics.list(), client.topics.listProgress()]).then(
      ([nodes, progressEntries]) => {
        if (!active) return;
        setTopics(nodes);

        const map = new Map<string, TopicProgressStatus>(
          progressEntries.map((p: TopicProgressEntry) => [p.topicNodeId, p.status]),
        );
        setProgressMap(map);

        const total = progressEntries.length;
        const done = progressEntries.filter((p: TopicProgressEntry) => p.status === 'completed').length;
        setGlobalProgress(total > 0 ? Math.round((done / total) * 100) : 0);
      },
    ).catch(() => {/* silently skip — sidebar still renders with empty data */});

    return () => { active = false; };
  }, [client]);

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ background: 'var(--aq-bg)' }}
    >
      {/* Mobile search bar — visible only on md and below */}
      <div className="hidden md:block">
        <Suspense>
          <MobileSearchBar />
        </Suspense>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — hidden on md and below, visible on lg and up */}
        <aside
          className="hidden flex-shrink-0 flex-col overflow-hidden lg:flex"
          style={{
            width: 280,
            background: 'var(--aq-bg2)',
            borderRight: '1px solid var(--aq-border)',
          }}
        >
          <Suspense fallback={<SidebarSkeleton />}>
            <CatalogSidebar
              topics={topics}
              progressMap={progressMap}
              globalProgress={globalProgress}
              isInstructor={isInstructor}
            />
          </Suspense>
        </aside>

        {/* Main content */}
        <main
          className="flex-1 overflow-y-auto"
          style={{ background: 'var(--aq-bg)' }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
