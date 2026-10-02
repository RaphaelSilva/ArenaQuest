'use client';

export const runtime = 'edge';

import { Suspense, use } from 'react';
import { MainPaneSkeleton } from '@web/components/catalog/MainPaneSkeleton';
import { SubmissionsPage } from '@web/components/catalog/submissions/SubmissionsPage';

type CatalogSubmissionsPageProps = {
  params: Promise<{ id: string }>;
};

/** `/catalog/[id]/submissions` — the topic's Demonstrations page; `?tab=` picks the tab. */
export default function CatalogSubmissionsPage({ params }: CatalogSubmissionsPageProps) {
  const { id } = use(params);
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[900px] px-4 py-8 md:px-6 lg:px-10">
          <MainPaneSkeleton />
        </div>
      }
    >
      <SubmissionsPage topicId={id} />
    </Suspense>
  );
}
