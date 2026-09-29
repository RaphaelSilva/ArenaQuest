'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { ClassifiedObject, StorageMissingObject } from '@web/lib/admin-storage-api';
import { StorageOwnerCell } from './storage-owner-cell';
import { StorageStatusBadge } from './storage-status-badge';
import { HINT_KEY, STATUS_KEY, formatBytes } from './storage-format';
import { useStorageScan, type ScanPageFetcher } from './use-storage-scan';

type Mode = 'orphans' | 'missing';

/** Group id for a non-`linked` object; a stale `pending` is its own group. */
type ObjectGroupId = ClassifiedObject['status'] | 'stale-pending';

/** Most actionable first: what could be reclaimed, then what is only drifting. */
const GROUP_ORDER: ObjectGroupId[] = ['orphan', 'deleted-row', 'stale-pending', 'displaced', 'pending', 'linked'];

/** The statuses the Phase 2 delete accepts — what "reclaimable" means here. */
const RECLAIMABLE: ReadonlySet<ObjectGroupId> = new Set(['orphan', 'deleted-row']);

const groupOf = (object: ClassifiedObject): ObjectGroupId =>
  object.status === 'pending' && object.stale ? 'stale-pending' : object.status;

const missingBytes = (row: StorageMissingObject): number =>
  row.reference.kind === 'media' ? row.reference.sizeBytes : 0;

const BUTTON =
  'inline-flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';

export type StorageScanPanelProps = {
  selectedKey: string | null;
  /** Opens the Task 04 detail drawer for this key. */
  onSelectObject: (key: string) => void;
};

/**
 * Whole-bucket audit, driven page by page from the browser (RFC 0018 §5):
 * "Scan for orphans" walks `/audit`, "Check for missing files" walks
 * `/audit/missing`. Only one scan runs at a time; starting one discards the
 * other's results. Read-only — nothing here deletes or changes a row.
 */
export function StorageScanPanel({ selectedKey, onSelectObject }: StorageScanPanelProps) {
  const d = useDict().adminStorage.scan;
  const client = useApiClient();
  const [mode, setMode] = useState<Mode | null>(null);

  const fetchOrphans = useCallback<ScanPageFetcher<ClassifiedObject>>(
    async (cursor, signal) => {
      const page = await client.adminStorage.audit({ cursor, signal });
      return { items: page.objects, scanned: page.scanned, nextCursor: page.nextCursor };
    },
    [client],
  );
  const fetchMissing = useCallback<ScanPageFetcher<StorageMissingObject>>(
    async (cursor, signal) => {
      const page = await client.adminStorage.auditMissing({ cursor, signal });
      return { items: page.items, scanned: page.scanned, nextCursor: page.nextCursor };
    },
    [client],
  );

  const orphans = useStorageScan(fetchOrphans);
  const missing = useStorageScan(fetchMissing);
  const active = mode === 'missing' ? missing : mode === 'orphans' ? orphans : null;
  const running = active?.status === 'running';

  const startOrphans = () => {
    missing.reset();
    setMode('orphans');
    orphans.start();
  };
  const startMissing = () => {
    orphans.reset();
    setMode('missing');
    missing.start();
  };

  // Keep the keyboard on a live control: the start buttons are disabled while a
  // run is active, so focus moves to Stop, and back to the start button after.
  const stopRef = useRef<HTMLButtonElement>(null);
  const startRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ orphans: null, missing: null });
  const wasRunning = useRef(false);
  useEffect(() => {
    if (running && !wasRunning.current) stopRef.current?.focus();
    if (!running && wasRunning.current && mode && document.activeElement === document.body) {
      startRefs.current[mode]?.focus();
    }
    wasRunning.current = running;
  }, [running, mode]);

  const progress =
    active && mode
      ? (() => {
          const count = mode === 'orphans' ? d.scannedKeys(active.scanned) : d.checkedReferences(active.scanned);
          if (active.status === 'running') return d.running(count);
          if (active.status === 'stopped') return d.stopped(count);
          if (active.status === 'done') return d.done(count);
          if (active.status === 'error') return d.failedAfter(count);
          return '';
        })()
      : d.idle;

  return (
    <section
      aria-labelledby="storage-scan-title"
      className="mb-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 id="storage-scan-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        {d.title}
      </h2>
      <p className="mb-3 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">{d.description}</p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={(el) => {
            startRefs.current.orphans = el;
          }}
          type="button"
          onClick={startOrphans}
          disabled={running}
          className={BUTTON}
        >
          {d.startOrphans}
        </button>
        <button
          ref={(el) => {
            startRefs.current.missing = el;
          }}
          type="button"
          onClick={startMissing}
          disabled={running}
          className={BUTTON}
        >
          {d.startMissing}
        </button>
        {running && active && (
          <button ref={stopRef} type="button" onClick={active.stop} className={BUTTON}>
            <Spinner className="h-4 w-4" />
            {d.stop}
          </button>
        )}
      </div>

      <p role="status" aria-live="polite" className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">
        {progress}
      </p>

      {active?.status === 'error' && (
        <div
          role="alert"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-200"
        >
          <span>{d.error}</span>
          <button
            type="button"
            onClick={active.retry}
            className="rounded-md border border-current px-3 py-1 font-medium"
          >
            {d.retry}
          </button>
        </div>
      )}

      {mode === 'orphans' && orphans.status !== 'idle' && (
        <OrphanResults
          objects={orphans.items}
          finished={orphans.status === 'done'}
          selectedKey={selectedKey}
          onSelectObject={onSelectObject}
        />
      )}
      {mode === 'missing' && missing.status !== 'idle' && (
        <MissingResults rows={missing.items} finished={missing.status === 'done'} />
      )}
    </section>
  );
}

function OrphanResults({
  objects,
  finished,
  selectedKey,
  onSelectObject,
}: {
  objects: ClassifiedObject[];
  finished: boolean;
  selectedKey: string | null;
  onSelectObject: (key: string) => void;
}) {
  const d = useDict().adminStorage;

  const groups = useMemo(() => {
    const byId = new Map<ObjectGroupId, ClassifiedObject[]>();
    for (const object of objects) {
      const id = groupOf(object);
      const list = byId.get(id);
      if (list) list.push(object);
      else byId.set(id, [object]);
    }
    return GROUP_ORDER.filter((id) => byId.has(id)).map((id) => {
      const items = byId.get(id)!;
      return { id, items, bytes: items.reduce((sum, o) => sum + o.size, 0) };
    });
  }, [objects]);

  const reclaimable = groups.filter((g) => RECLAIMABLE.has(g.id)).reduce((sum, g) => sum + g.bytes, 0);

  if (groups.length === 0) {
    return finished ? <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{d.scan.emptyOrphans}</p> : null;
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{d.scan.reclaimable(formatBytes(reclaimable))}</p>
      <ul aria-label={d.scan.resultsLabel} className="flex flex-col gap-2">
        {groups.map((group) => (
          <ResultGroup
            key={group.id}
            groupId={group.id}
            label={group.id === 'stale-pending' ? d.status.stalePending : d.status[STATUS_KEY[group.id]]}
            badge={
              <StorageStatusBadge
                status={group.id === 'stale-pending' ? 'pending' : group.id}
                stale={group.id === 'stale-pending'}
              />
            }
            count={group.items.length}
            bytes={group.bytes}
          >
            {group.items.map((object) => (
              <li
                key={object.key}
                className={`flex flex-col gap-1 px-3 py-2 md:flex-row md:items-center md:justify-between md:gap-4 ${
                  selectedKey === object.key ? 'bg-indigo-50 dark:bg-indigo-950/40' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectObject(object.key)}
                  aria-label={d.openObject(object.key)}
                  className="min-w-0 break-all text-left text-sm font-medium text-zinc-900 hover:text-indigo-600 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-50 dark:hover:text-indigo-400"
                >
                  {object.key}
                </button>
                <span className="shrink-0 text-xs text-zinc-600 dark:text-zinc-400">
                  {formatBytes(object.size)}
                  {object.hint && <> · {d.hint[HINT_KEY[object.hint]]}</>}
                </span>
              </li>
            ))}
          </ResultGroup>
        ))}
      </ul>
    </div>
  );
}

function MissingResults({ rows, finished }: { rows: StorageMissingObject[]; finished: boolean }) {
  const d = useDict().adminStorage.scan;

  if (rows.length === 0) {
    return finished ? <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{d.emptyMissing}</p> : null;
  }

  return (
    <ul aria-label={d.resultsLabel} className="mt-3 flex flex-col gap-2">
      <ResultGroup
        groupId="missing-object"
        label={d.missingObject}
        count={rows.length}
        bytes={rows.reduce((sum, row) => sum + missingBytes(row), 0)}
      >
        {rows.map((row) => (
          <li
            key={`${row.reference.kind}:${row.key}`}
            className="grid grid-cols-1 gap-1 px-3 py-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-4"
          >
            <span className="min-w-0 break-all text-sm font-medium text-zinc-900 dark:text-zinc-50">{row.key}</span>
            <span className="min-w-0 text-sm">
              <StorageOwnerCell references={[row.reference]} />
            </span>
          </li>
        ))}
      </ResultGroup>
    </ul>
  );
}

/**
 * One status group: a toggle showing label, count and total bytes; the rows
 * are only rendered when expanded, so a large scan stays cheap to paint.
 */
function ResultGroup({
  groupId,
  label,
  badge,
  count,
  bytes,
  children,
}: {
  groupId: string;
  label: string;
  badge?: ReactNode;
  count: number;
  bytes: number;
  children: ReactNode;
}) {
  const d = useDict().adminStorage.scan;
  const [open, setOpen] = useState(false);
  const listId = `storage-scan-group-${groupId}`;

  return (
    <li data-group={groupId} className="overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center justify-between gap-2 bg-zinc-50 px-3 py-2 text-left hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500 dark:bg-zinc-900 dark:hover:bg-zinc-800"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {badge ?? label}
        </span>
        <span data-testid="group-summary" className="text-sm text-zinc-600 dark:text-zinc-400">
          {d.groupSummary(count, formatBytes(bytes))}
        </span>
      </button>
      {open && (
        <ul id={listId} className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {children}
        </ul>
      )}
    </li>
  );
}
