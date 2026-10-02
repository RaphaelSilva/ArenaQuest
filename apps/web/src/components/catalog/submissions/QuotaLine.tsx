'use client';

import { useDict } from '@web/context/dict-context';
import type { SubmissionSummary } from '@web/lib/submissions-api';
import { formatBytes } from './submission-format';

/** *"3 de 10 neste tópico · 420 MB de 1 GB"* — every number from the summary. */
export function QuotaLine({ summary }: { summary: SubmissionSummary }) {
  const dict = useDict();
  return (
    <p className="text-[13px]" style={{ color: 'var(--aq-text2)' }}>
      {dict.submissions.quota.line(
        summary.usage.topicCount,
        summary.limits.perTopicMax,
        formatBytes(dict, summary.usage.bytes),
        formatBytes(dict, summary.limits.storagePerStudentBytes),
      )}
    </p>
  );
}
