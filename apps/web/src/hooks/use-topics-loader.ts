import { useEffect, useState, useCallback } from 'react';
import { adminTopicsApi, type TopicNode } from '@web/lib/admin-topics-api';
import { useAuth } from './use-auth';

export function useTopicsLoader() {
  const [nodes, setNodes] = useState<TopicNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const { accessToken, refreshSession, setAccessToken, onSessionExpired } = useAuth();

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setError('');
    try {
      const data = await adminTopicsApi.list(
        accessToken,
        refreshSession,
        setAccessToken,
        onSessionExpired,
      );
      setNodes(data);
    } catch {
      setError('Failed to load topics.');
    } finally {
      setLoading(false);
    }
  }, [accessToken, refreshSession, setAccessToken, onSessionExpired]);

  useEffect(() => {
    if (accessToken) refresh();
  }, [accessToken, refresh]);

  return { nodes, setNodes, loading, error, refresh };
}
