'use client';

import { useEffect, useState, use } from 'react';

export const runtime = 'edge';
import { useAuth } from '@web/hooks/use-auth';
import { topicsApi } from '@web/lib/topics-api';
import type { TopicNode } from '@web/lib/topics-api';
import { MarkdownViewer } from '@web/components/catalog/MarkdownViewer';
import { MediaViewer } from '@web/components/catalog/MediaViewer';
import { Spinner } from '@web/components/spinner';

type CatalogTopicPageProps = {
  params: Promise<{ id: string }>;
};

export default function CatalogTopicPage({ params }: CatalogTopicPageProps) {
  // next.js 15 requires awaiting params
  const { id } = use(params);
  const { accessToken } = useAuth();
  
  const [topic, setTopic] = useState<TopicNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!accessToken) return;
    
    let isMounted = true;

    topicsApi.getById(accessToken, id)
      .then((data) => {
        if (isMounted) {
          setTopic(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load topic details');
          setLoading(false);
        }
      });
      
    return () => { isMounted = false; };
  }, [accessToken, id]);

  if (error) {
    return (
      <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-8 text-center">
        <div className="mb-4 rounded-full bg-red-50 p-4 text-red-500 dark:bg-red-500/10 dark:text-red-400">
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <p className="text-sm font-medium text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (loading || !topic) {
    return (
      <div className="flex h-full min-h-[50vh] items-center justify-center p-8">
        <Spinner className="h-8 w-8 text-zinc-400" />
      </div>
    );
  }

  // Filter for only 'ready' media items
  const readyMedia = topic.media?.filter((m) => m.status === 'ready') || [];

  return (
    <div className="mx-auto max-w-4xl p-8 pb-24">
      <header className="mb-10">
        <div className="mb-3 flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <span className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-medium shadow-sm ring-1 ring-inset ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {topic.estimatedMinutes} mins
          </span>
          {topic.tags && topic.tags.length > 0 && (
            <div className="flex gap-2">
              {topic.tags.map(tag => (
                <span key={tag.id} className="rounded-md bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>
        
        <h1 className="text-4xl font-extrabold tracking-tight text-zinc-900 dark:text-white sm:text-5xl">
          {topic.title}
        </h1>
      </header>

      {/* Main Content (Markdown) */}
      {topic.content ? (
        <div className="mb-16 rounded-2xl border border-zinc-100 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
          <MarkdownViewer content={topic.content} />
        </div>
      ) : (
        <div className="mb-16 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 p-8 text-center dark:border-zinc-800 dark:bg-zinc-900/20">
          <p className="text-zinc-500 dark:text-zinc-400">No text content available for this topic.</p>
        </div>
      )}

      {/* Media Attachments */}
      {readyMedia.length > 0 && (
        <div className="space-y-8 border-t border-zinc-200 pt-10 dark:border-zinc-800">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Course Materials
          </h2>
          <div className="grid gap-8 md:grid-cols-1 lg:grid-cols-2">
            {readyMedia.map((m) => (
              <MediaViewer key={m.id} media={m} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
