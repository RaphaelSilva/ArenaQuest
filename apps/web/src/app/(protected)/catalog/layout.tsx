'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@web/hooks/use-auth';
import { topicsApi } from '@web/lib/topics-api';
import type { TopicNode } from '@web/lib/topics-api';
import { CatalogSidebar } from '@web/components/catalog/CatalogSidebar';
import { Spinner } from '@web/components/spinner';

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  const { accessToken } = useAuth();
  const [topics, setTopics] = useState<TopicNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    
    let isMounted = true;
    
    topicsApi.list(accessToken)
      .then((data) => {
        if (isMounted) {
          setTopics(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load catalogue');
          setLoading(false);
        }
      });
      
    return () => { isMounted = false; };
  }, [accessToken]);

  return (
    <div className="flex flex-1 overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {/* Sidebar Navigation */}
      <aside className="w-80 flex-shrink-0 overflow-y-auto border-r border-zinc-200/80 bg-white/30 p-6 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-900/10">
        <div className="mb-6">
          <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Catalogue</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Browse published content</p>
        </div>

        {error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        ) : (
          <CatalogSidebar topics={topics} />
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
