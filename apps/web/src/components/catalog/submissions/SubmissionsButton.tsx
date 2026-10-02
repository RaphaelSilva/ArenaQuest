'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { useHasRole } from '@web/hooks/use-auth';
import type { SubmissionSummary } from '@web/lib/submissions-api';

/**
 * The only piece of the feature on the topic page: a link to the
 * Demonstrations page carrying the caller's and the class counts (the class
 * count is omitted when the label's sharing is off). Staff get *Student
 * demonstrations* with the topic's total instead. Without a summary the
 * button still renders, just without counts.
 */
export function SubmissionsButton({ topicId }: { topicId: string }) {
  const dict = useDict();
  const t = dict.submissions.button;
  const client = useApiClient();
  const isStaff = useHasRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR);
  const [summary, setSummary] = useState<SubmissionSummary | null>(null);

  useEffect(() => {
    let active = true;
    client.submissions.summary(topicId).then(
      (s) => {
        if (active) setSummary(s);
      },
      () => {
        if (active) setSummary(null);
      },
    );
    return () => {
      active = false;
    };
  }, [client, topicId]);

  const counts = !summary
    ? null
    : isStaff
      ? t.total(summary.totalCount ?? 0)
      : summary.sharingEnabled
      ? t.mineAndClass(summary.usage.topicCount, summary.classCount)
        : t.mine(summary.usage.topicCount);

  return (
    <div className="mb-8">
      <Link
        href={`/catalog/${topicId}/submissions`}
        className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-[10px] border px-4 py-2.5 transition-colors duration-150 hover:border-[var(--aq-accent)]"
        style={{ borderColor: 'var(--aq-border2)', background: 'var(--aq-bg2)' }}
      >
        <span aria-hidden>🎬</span>
        <span className="text-[14px] font-bold" style={{ color: 'var(--aq-text)' }}>
          {isStaff ? t.staffLabel : t.label}
        </span>
        {counts && (
          <span className="text-[13px]" style={{ color: 'var(--aq-text2)' }}>
            {counts}
          </span>
        )}
      </Link>
    </div>
  );
}
