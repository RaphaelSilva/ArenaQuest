'use client';

import { useState } from 'react';
import { adminMediaApi, type Media } from '@web/lib/admin-media-api';
import { Spinner } from '@web/components/spinner';

type MediaListProps = {
  topicId: string;
  token: string;
  media: Media[];
  onMediaDeleted: () => void;
};

export function MediaList({ topicId, token, media, onMediaDeleted }: MediaListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this media?')) return;
    
    setDeletingId(id);
    try {
      await adminMediaApi.delete(token, topicId, id);
      onMediaDeleted();
    } catch {
      alert('Failed to delete media');
    } finally {
      setDeletingId(null);
    }
  };

  if (media.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/50 py-12 dark:border-zinc-800 dark:bg-zinc-900/20">
        <svg className="h-8 w-8 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No media attached to this topic.</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {media.map((item) => {
        const isPdf = item.type === 'application/pdf';
        const isVideo = item.type.startsWith('video/');
        const isImage = item.type.startsWith('image/');
        
        return (
          <li key={item.id} className="flex items-center justify-between p-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
            <div className="flex items-center gap-4 truncate">
              <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
                isPdf ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400' :
                isVideo ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400' :
                isImage ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' :
                'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
              }`}>
                {isPdf && (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                )}
                {isVideo && (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
                {isImage && (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                )}
                {!isPdf && !isVideo && !isImage && (
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                )}
              </div>
              <div className="flex flex-col truncate">
                <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {item.originalName}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">
                  {(item.sizeBytes / 1024 / 1024).toFixed(2)} MB • {item.status}
                </span>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
               {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
                  title="Download / View"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </a>
              )}
              <button
                onClick={() => handleDelete(item.id)}
                disabled={deletingId === item.id}
                className="rounded-full p-2 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                title="Delete"
              >
                {deletingId === item.id ? (
                   <Spinner className="h-4 w-4" />
                ) : (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                )}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
