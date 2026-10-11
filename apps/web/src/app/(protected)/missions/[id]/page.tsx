'use client';

import { useParams } from 'next/navigation';
import { MissionPage } from '@web/components/missions/MissionPage';

export const runtime = 'edge';

/** A student's mission: steps, self-checks and *Leave* (RFC 0022 §7). */
export default function StudentMissionPage() {
  const params = useParams<{ id: string }>();

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        {params.id && <MissionPage key={params.id} missionId={params.id} />}
      </div>
    </main>
  );
}
