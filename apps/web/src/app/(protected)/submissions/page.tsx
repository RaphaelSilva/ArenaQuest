'use client';

import { useDict } from '@web/context/dict-context';
import { MySubmissionsList } from '@web/components/catalog/submissions/MySubmissionsList';

/** "My demonstrations": every submission the student sent, across topics, grouped by topic. */
export default function MySubmissionsPage() {
  const dict = useDict();
  const t = dict.submissions.myDemonstrations;

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="mb-1 text-2xl font-semibold" style={{ color: 'var(--aq-text)' }}>
          {t.title}
        </h1>
        <p className="mb-6 text-[13px]" style={{ color: 'var(--aq-text2)' }}>
          {t.subtitle}
        </p>
        <MySubmissionsList />
      </div>
    </main>
  );
}
