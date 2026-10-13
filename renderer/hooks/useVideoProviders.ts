import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderPublicConfig } from '../../types/videoProvider';
import { videoCreationClient } from '../lib/videoCreationClient';
import type { ProviderSaveDraft } from '../components/resources/engines/panels/VideoProviderForm';
export default function useVideoProviders() {
  const [providers, setProviders] = useState<ProviderPublicConfig[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const token = ++epoch.current;
    try {
      const result = await videoCreationClient.call('listProviders', {});
      if (token !== epoch.current) return;
      if (!Array.isArray(result))
        throw new Error('INVALID_VIDEO_PROVIDER_RESPONSE');
      setProviders(result as ProviderPublicConfig[]);
      setLoaded(true);
      setError('');
    } catch (e) {
      if (token === epoch.current)
        setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const unsubscribe = window.ipc?.on?.(
      'videoCreation:changed',
      (event: { projectId?: string }) => {
        if (!event.projectId) void refresh();
      },
    );
    return () => {
      epoch.current++;
      unsubscribe?.();
    };
  }, [refresh]);
  const save = async (draft: ProviderSaveDraft, expectedVersion: number) => {
    const { secret, ...config } = draft;
    const result = await videoCreationClient.call('saveProvider', {
      draft: { ...config, expectedVersion },
      secret,
      expectedVersion,
    });
    await refresh();
    return result;
  };
  const remove = async (id: string, expectedVersion: number) => {
    await videoCreationClient.call('deleteProvider', {
      providerId: id,
      expectedVersion,
    });
    await refresh();
  };
  return { providers, loaded, error, refresh, save, remove };
}
export type VideoProviderHook = ReturnType<typeof useVideoProviders>;
