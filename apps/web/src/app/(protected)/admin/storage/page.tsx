'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useAuth, useHasRole } from '@web/hooks/use-auth';
import { useDict } from '@web/context/dict-context';
import { Spinner } from '@web/components/spinner';
import { StorageBreadcrumb } from '@web/components/admin/storage/storage-breadcrumb';
import { StorageListing } from '@web/components/admin/storage/storage-listing';
import { StorageObjectDrawer } from '@web/components/admin/storage/storage-object-drawer';
import { useStorageFolder } from '@web/components/admin/storage/use-storage-folder';
import { useStorageObject } from '@web/components/admin/storage/use-storage-object';

/**
 * `/admin/storage` — the bucket as topic and event folders (RFC 0018).
 *
 * Read-only: nothing on this page uploads, renames or moves an object, and the
 * status of every object is resolved by the API. ADMIN only, matching the
 * router's own `requireRole(ROLES.ADMIN)` — the bucket crosses every topic and
 * event, drafts and restricted events included.
 */
export default function AdminStoragePage() {
  const d = useDict().adminStorage;
  const router = useRouter();
  const { isLoading: authLoading } = useAuth();
  const isAdmin = useHasRole(ROLES.ADMIN);

  const folder = useStorageFolder(!authLoading && isAdmin);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const object = useStorageObject(selectedKey);

  useEffect(() => {
    if (!authLoading && !isAdmin) router.replace('/dashboard');
  }, [authLoading, isAdmin, router]);

  const closeDrawer = useCallback(() => setSelectedKey(null), []);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="h-8 w-8 text-zinc-600" />
      </div>
    );
  }
  if (!isAdmin) return null;

  return (
    <main className="flex-1 overflow-y-auto p-4 md:p-8">
      <div className="mb-5">
        <h1
          className="text-[28px] font-bold text-zinc-900 dark:text-zinc-50"
          style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: '-0.5px' }}
        >
          {d.title}
        </h1>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.subtitle}</p>
      </div>

      <StorageBreadcrumb prefix={folder.prefix} titles={folder.titles} onNavigate={folder.navigate} />

      <StorageListing
        folders={folder.folders}
        objects={folder.objects}
        status={folder.status}
        loadingMore={folder.loadingMore}
        hasMore={folder.nextCursor !== null}
        selectedKey={selectedKey}
        onOpenFolder={(f) => void folder.navigate(f.prefix)}
        onSelectObject={(o) => setSelectedKey(o.key)}
        onLoadMore={() => void folder.loadMore()}
        onRetry={() => void folder.reload()}
      />

      {selectedKey && (
        <StorageObjectDrawer
          objectKey={selectedKey}
          state={object.state}
          onClose={closeDrawer}
          onRetry={object.retry}
        />
      )}
    </main>
  );
}
