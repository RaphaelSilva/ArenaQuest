'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useApiClient } from '@web/context/auth-context';

export type TopicMediaStat =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; media: number; videos: number };

/**
 * Ready media and ready videos of each topic a `topic_visited` /
 * `video_watched` step targets, read lazily from `GET /admin/topics/{id}/media`.
 *
 * The topic list's `mediaCount` is not used: it groups by the raw media `type`
 * (a MIME type such as `video/mp4`), so its `video` bucket stays at zero. The
 * API's own check for `video_watched` counts `ready` media whose type starts
 * with `video/`, and this hook counts the same way.
 */
export function useTopicMediaStats(topicIds: string[]): Record<string, TopicMediaStat> {
  const client = useApiClient();
  const [stats, setStats] = useState<Record<string, TopicMediaStat>>({});
  const requested = useRef(new Set<string>());
  const key = [...new Set(topicIds.filter(Boolean))].sort().join(',');

  useEffect(() => {
    const ids = key ? key.split(',') : [];
    for (const topicId of ids) {
      if (requested.current.has(topicId)) continue;
      requested.current.add(topicId);
      client.adminMedia
        .list(topicId)
        .then((media) => {
          const ready = media.filter((m) => m.status === 'ready');
          const videos = ready.filter((m) => m.type.startsWith('video/')).length;
          setStats((s) => ({ ...s, [topicId]: { status: 'ready', media: ready.length, videos } }));
        })
        .catch(() => {
          setStats((s) => ({ ...s, [topicId]: { status: 'error' } }));
        });
    }
  }, [client, key]);

  // A requested topic with no answer yet reads as loading.
  return useMemo(() => {
    const all: Record<string, TopicMediaStat> = {};
    for (const topicId of key ? key.split(',') : []) all[topicId] = stats[topicId] ?? { status: 'loading' };
    return all;
  }, [key, stats]);
}
