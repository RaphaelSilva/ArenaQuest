import { useEffect, useState, useCallback } from 'react';
import { adminMediaApi, type Media } from '@web/lib/admin-media-api';
import { useAuth } from './use-auth';

type Props = {
  topicId: string | null;
  enabled?: boolean;
};

export function useMediaLoader({ topicId, enabled = true }: Props) {
  const [media, setMedia] = useState<Media[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();

  const loadMedia = useCallback(async () => {
    if (!topicId || !accessToken || !enabled) return;

    setLoading(true);
    setError(null);
    try {
      const data = await adminMediaApi.list(
        accessToken,
        topicId,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      );
      setMedia(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load media');
    } finally {
      setLoading(false);
    }
  }, [topicId, accessToken, enabled, refreshSession, setAccessToken, onSessionExpired]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  return { media, loading, error, reload: loadMedia };
}
