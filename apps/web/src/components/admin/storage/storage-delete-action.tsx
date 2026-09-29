'use client';

import { useId, useState } from 'react';
import { ORPHAN_GRACE_MS } from '@arenaquest/shared/domain/storage/key-owners';
import { useDict } from '@web/context/dict-context';
import type { ClassifiedObject } from '@web/lib/admin-storage-api';

/** The only statuses the server's delete accepts (RFC 0018 §6). */
const DELETABLE: ReadonlySet<ClassifiedObject['status']> = new Set(['orphan', 'deleted-row']);

/** Whether the server's delete could ever accept this status. */
export const isDeletableStatus = (status: ClassifiedObject['status']): boolean => DELETABLE.has(status);

export type DeleteEligibility =
  | { visible: false }
  | { visible: true; disabledReason: 'within-grace-window' | null };

/**
 * Client-side mirror of the server's delete guard, used only to hide or
 * disable the button — the server re-classifies on every request and its
 * `409` is always handled. Same comparison as the API: an object is still in
 * its grace window while `now - uploadedAt <= ORPHAN_GRACE_MS`.
 */
export function deleteEligibility(
  object: Pick<ClassifiedObject, 'status' | 'uploadedAt'>,
  now: number,
): DeleteEligibility {
  if (!isDeletableStatus(object.status)) return { visible: false };
  const uploadedAt = Date.parse(object.uploadedAt);
  const withinGrace = Number.isNaN(uploadedAt) || now - uploadedAt <= ORPHAN_GRACE_MS;
  return { visible: true, disabledReason: withinGrace ? 'within-grace-window' : null };
}

/**
 * The *Delete* action for one object: absent for every status but `orphan`
 * and `deleted-row`, and disabled — with its reason shown next to it — while
 * the object is younger than 24 h. It only opens the confirmation dialog.
 */
export function StorageDeleteButton({
  object,
  onDelete,
  compact = false,
}: {
  object: ClassifiedObject;
  onDelete: (object: ClassifiedObject) => void;
  /** Smaller variant for scan-result rows. */
  compact?: boolean;
}) {
  const d = useDict().adminStorage.delete;
  const reasonId = useId();
  // Read once per mount: the grace window is 24 h, so a render-time clock
  // would only add churn. The server has the final word anyway.
  const [now] = useState(() => Date.now());
  const eligibility = deleteEligibility(object, now);
  if (!eligibility.visible) return null;

  const disabled = eligibility.disabledReason !== null;

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
      <button
        type="button"
        onClick={() => onDelete(object)}
        disabled={disabled}
        aria-label={d.actionFor(object.name)}
        aria-describedby={disabled ? reasonId : undefined}
        className={`inline-flex items-center rounded-md border border-red-300 font-medium text-red-700 hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40 ${
          compact ? 'px-2 py-0.5' : 'px-4 py-2'
        }`}
      >
        {d.action}
      </button>
      {disabled && (
        <span id={reasonId} className="text-zinc-600 dark:text-zinc-400">
          {d.tooRecent}
        </span>
      )}
    </span>
  );
}
