'use client';

import Link from 'next/link';
import { useDict } from '@web/context/dict-context';
import type { StorageReference } from '@web/lib/admin-storage-api';

const LINK_CLASS =
  'font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400';

/**
 * The resolved owner of an object: the topic (with the original file name and
 * uploader) for topic media, the event for a flyer. Only the first reference is
 * shown inline — the drawer lists all of them.
 */
export function StorageOwnerCell({ references }: { references: StorageReference[] }) {
  const d = useDict().adminStorage;
  const [first, ...rest] = references;

  if (!first) {
    return <span className="text-zinc-500 dark:text-zinc-400">{d.owner.none}</span>;
  }

  return (
    <span className="flex flex-col gap-0.5">
      <OwnerLine reference={first} />
      {rest.length > 0 && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {d.owner.moreReferences(rest.length)}
        </span>
      )}
    </span>
  );
}

function OwnerLine({ reference }: { reference: StorageReference }) {
  const d = useDict().adminStorage;

  if (reference.kind === 'media') {
    return (
      <span className="flex flex-col gap-0.5">
        {/* The topic editor has no per-topic route; the tree lives at `/admin/topics`. */}
        <Link href="/admin/topics" className={LINK_CLASS}>
          {reference.topic?.title ?? d.owner.topicGone}
        </Link>
        <span className="break-all text-xs text-zinc-600 dark:text-zinc-400">
          {reference.originalName}
          {reference.uploader && <> · {d.owner.uploadedBy(reference.uploader.name)}</>}
        </span>
      </span>
    );
  }

  return (
    <Link href={`/admin/events/${reference.eventId}`} className={LINK_CLASS}>
      {reference.title}
    </Link>
  );
}
