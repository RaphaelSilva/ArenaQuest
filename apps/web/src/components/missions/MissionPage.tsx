'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@web/components/design-system';
import { Spinner } from '@web/components/spinner';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { MissionsApiError, type DashboardMissionEntry, type MissionCheckResult } from '@web/lib/missions-api';
import { JoinMissionButton } from './JoinMissionButton';
import { LeaveMissionDialog } from './LeaveMissionDialog';
import { ManualCheckButton } from './ManualCheckButton';
import { MissionDescription } from './MissionDescription';
import { MissionHeader } from './MissionHeader';
import { MissionStepList } from './MissionStepList';
import { missionErrorMessage } from './student-mission-errors';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; entry: DashboardMissionEntry }
  | { kind: 'notFound' }
  | { kind: 'error'; message: string };

function BackLink() {
  const d = useDict().missions.page;
  return (
    <Link href="/dashboard" className="text-xs underline-offset-2 hover:underline" style={{ color: 'var(--aq-text3)' }}>
      {d.backToDashboard}
    </Link>
  );
}

/**
 * The app has no `not-found.tsx` and never calls `notFound()`, so a `404` from
 * the API (a mission the student may not see, RFC 0022 §8) renders this inline.
 */
function MissionNotFound() {
  const d = useDict().missions.page;
  return (
    <section data-testid="mission-not-found" className="flex flex-col items-center gap-3 py-16 text-center">
      <h1 className="text-xl font-semibold" style={{ color: 'var(--aq-text)' }}>
        {d.notFoundTitle}
      </h1>
      <p className="text-sm" style={{ color: 'var(--aq-text3)' }}>
        {d.notFoundBody}
      </p>
      <BackLink />
    </section>
  );
}

/** The loaded mission: header, description and every step with its *I did it*. */
export function MissionDetail({
  entry,
  onChange,
}: {
  entry: DashboardMissionEntry;
  onChange: (entry: DashboardMissionEntry) => void;
}) {
  const d = useDict().missions;
  const { mission, enrollment } = entry;
  // The check route only accepts a participant; a joinable visitor joins first.
  const participating = enrollment !== null;

  const onChecked = (result: MissionCheckResult) => {
    // The returned entry already carries the ticked step; the step replaces its row in case it differs.
    const steps = result.mission.steps.map((s) => (s.id === result.step.id ? result.step : s));
    onChange({ ...result.mission, steps });
  };

  let actions = null;
  if (enrollment?.source === 'self') actions = <LeaveMissionDialog missionId={mission.id} title={mission.title} />;
  else if (!participating && entry.joinable)
    actions = <JoinMissionButton missionId={mission.id} title={mission.title} onJoined={onChange} />;

  return (
    <article className="flex flex-col gap-6">
      <MissionHeader entry={entry} actions={actions} />
      <MissionDescription description={mission.description} />
      {entry.steps.length > 0 && (
        <section aria-labelledby="mission-steps-title" className="flex flex-col gap-3">
          <h2
            id="mission-steps-title"
            className="text-[13px] font-semibold"
            style={{ color: 'var(--aq-text)', fontFamily: "'Space Grotesk', sans-serif" }}
          >
            {d.page.stepsTitle}
          </h2>
          <MissionStepList
            title={mission.title}
            mode={mission.mode}
            steps={entry.steps}
            renderAction={
              participating
                ? (step) =>
                    step.kind === 'manual_check' ? (
                      <ManualCheckButton missionId={mission.id} step={step} onChecked={onChecked} />
                    ) : null
                : undefined
            }
          />
        </section>
      )}
    </article>
  );
}

/**
 * The mission page (RFC 0022 §7): loads `GET /v1/me/missions/{id}` and renders
 * the loading, not-found, error and loaded states.
 */
export function MissionPage({ missionId }: { missionId: string }) {
  const d = useDict().missions;
  const client = useApiClient();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', entry: await client.missions.getMission(missionId) });
    } catch (err: unknown) {
      if (err instanceof MissionsApiError && err.status === 404) setState({ kind: 'notFound' });
      else setState({ kind: 'error', message: missionErrorMessage(err, d) });
    }
  }, [client, missionId, d]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch is the canonical use case
    void load();
  }, [load]);

  if (state.kind === 'loading') {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-16" style={{ color: 'var(--aq-text3)' }}>
        <Spinner />
        <span className="text-sm">{d.page.loading}</span>
      </div>
    );
  }

  if (state.kind === 'notFound') return <MissionNotFound />;

  if (state.kind === 'error') {
    return (
      <section className="flex flex-col items-start gap-3 py-8">
        <div role="alert" className="flex flex-col gap-1 text-sm" style={{ color: 'var(--aq-error)' }}>
          <p>{d.page.loadError}</p>
          <p>{state.message}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void load()}>
          {d.page.retry}
        </Button>
        <BackLink />
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <MissionDetail entry={state.entry} onChange={(entry) => setState({ kind: 'ready', entry })} />
    </div>
  );
}
