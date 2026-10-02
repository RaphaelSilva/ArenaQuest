'use client';

export const runtime = 'edge';

import { Suspense, use } from 'react';
import { MainPaneSkeleton } from '@web/components/catalog/MainPaneSkeleton';
import { SubmissionsPage } from '@web/components/catalog/submissions/SubmissionsPage';

type CatalogSubmissionLinkPageProps = {
  params: Promise<{ id: string; sid: string }>;
};

/**
 * `/catalog/[id]/submissions/[sid]` — the direct link to one submission: the
 * Demonstrations page with the viewer open on it. The link only encodes ids;
 * whether the caller may see it is the API's decision, and a `404` renders the
 * same not-found state as an unreadable topic.
 */
export default function CatalogSubmissionLinkPage({ params }: CatalogSubmissionLinkPageProps) {
  const { id, sid } = use(params);
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[900px] px-4 py-8 md:px-6 lg:px-10">
          <MainPaneSkeleton />
        </div>
      }
    >
      <SubmissionsPage topicId={id} submissionId={sid} />
    </Suspense>
  );
}
