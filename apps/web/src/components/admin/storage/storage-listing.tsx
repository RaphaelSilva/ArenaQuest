'use client';

import { Spinner } from '@web/components/spinner';
import { useDict } from '@web/context/dict-context';
import type { ClassifiedObject, StorageFolder } from '@web/lib/admin-storage-api';
import { StorageStatusBadge } from './storage-status-badge';
import { StorageOwnerCell } from './storage-owner-cell';
import { SUBMISSIONS_ROOT, formatBytes, formatTimestamp } from './storage-format';

/**
 * One grid for both breakpoints: rows stack on mobile and line up as table
 * columns from `md` up. A single tree (rather than a `<table>` plus a mobile
 * list) keeps each row reachable exactly once by keyboard and by tests.
 */
const ROW_GRID =
  'grid grid-cols-1 gap-1 px-4 py-3 md:grid-cols-[minmax(0,2fr)_6rem_10rem_9rem_minmax(0,2fr)] md:items-center md:gap-4';

export type StorageListingProps = {
  folders: StorageFolder[];
  objects: ClassifiedObject[];
  status: 'loading' | 'error' | 'ready';
  loadingMore: boolean;
  hasMore: boolean;
  selectedKey: string | null;
  onOpenFolder: (folder: StorageFolder) => void;
  onSelectObject: (object: ClassifiedObject) => void;
  onLoadMore: () => void;
  onRetry: () => void;
};

export function StorageListing({
  folders,
  objects,
  status,
  loadingMore,
  hasMore,
  selectedKey,
  onOpenFolder,
  onSelectObject,
  onLoadMore,
  onRetry,
}: StorageListingProps) {
  const d = useDict().adminStorage;

  if (status === 'loading') {
    return (
      <div role="status" className="flex items-center gap-2 py-10 text-sm text-zinc-600 dark:text-zinc-400">
        <Spinner className="h-5 w-5" />
        {d.loading}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div
        role="alert"
        className="flex flex-wrap items-center gap-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200"
      >
        <span>{d.error}</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-current px-3 py-1 font-medium"
        >
          {d.retry}
        </button>
      </div>
    );
  }

  if (folders.length === 0 && objects.length === 0) {
    return <p className="py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">{d.empty}</p>;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div
        aria-hidden="true"
        className={`${ROW_GRID} hidden border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wider text-zinc-600 md:grid dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400`}
      >
        <span>{d.columns.name}</span>
        <span>{d.columns.size}</span>
        <span>{d.columns.uploadedAt}</span>
        <span>{d.columns.status}</span>
        <span>{d.columns.owner}</span>
      </div>

      <ul aria-label={d.listingLabel} className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {folders.map((folder) => (
          <li key={folder.prefix}>
            <FolderRow folder={folder} onOpen={onOpenFolder} />
          </li>
        ))}
        {objects.map((object) => (
          <li
            key={object.key}
            className={selectedKey === object.key ? 'bg-indigo-50 dark:bg-indigo-950/40' : undefined}
          >
            <ObjectRow object={object} onSelect={onSelectObject} />
          </li>
        ))}
      </ul>

      {hasMore && (
        <div className="border-t border-zinc-200 p-3 text-center dark:border-zinc-800">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {loadingMore && <Spinner className="h-4 w-4" />}
            {d.loadMore}
          </button>
        </div>
      )}
    </div>
  );
}

function FolderRow({ folder, onOpen }: { folder: StorageFolder; onOpen: (folder: StorageFolder) => void }) {
  const d = useDict().adminStorage;
  // `submissions/<authorId>/` folders carry no owner; only the root is labelled.
  const rootLabel = folder.prefix === SUBMISSIONS_ROOT ? d.folder.submissionsRoot : null;
  const label = folder.owner?.title ?? rootLabel ?? folder.name;

  return (
    <button
      type="button"
      onClick={() => onOpen(folder)}
      aria-label={d.folder.open(label)}
      className={`${ROW_GRID} w-full text-left hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 dark:hover:bg-zinc-900`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <FolderIcon />
        <span className="min-w-0">
          <span className="block truncate font-medium text-zinc-900 dark:text-zinc-50">{label}</span>
          {folder.owner && (
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {d.folder.kind[folder.owner.kind]} · {folder.name}
            </span>
          )}
          {!folder.owner && rootLabel && (
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{folder.name}</span>
          )}
        </span>
      </span>
      <span className="hidden md:block" />
      <span className="hidden md:block" />
      <span>
        {folder.ownerGone && (
          <span className="inline-flex rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
            {d.folder.gone}
          </span>
        )}
      </span>
      <span className="hidden md:block" />
    </button>
  );
}

function ObjectRow({
  object,
  onSelect,
}: {
  object: ClassifiedObject;
  onSelect: (object: ClassifiedObject) => void;
}) {
  const d = useDict().adminStorage;

  return (
    <div className={ROW_GRID}>
      <button
        type="button"
        onClick={() => onSelect(object)}
        aria-label={d.openObject(object.name)}
        className="min-w-0 break-all text-left font-medium text-zinc-900 hover:text-indigo-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-50 dark:hover:text-indigo-400"
      >
        {object.name}
      </button>
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        <span className="md:hidden">{d.columns.size}: </span>
        {formatBytes(object.size)}
      </span>
      <span className="text-sm text-zinc-600 dark:text-zinc-400">
        <span className="md:hidden">{d.columns.uploadedAt}: </span>
        {formatTimestamp(object.uploadedAt)}
      </span>
      <span>
        <StorageStatusBadge status={object.status} stale={object.stale} />
      </span>
      <span className="min-w-0 text-sm">
        <StorageOwnerCell references={object.references} />
      </span>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}
