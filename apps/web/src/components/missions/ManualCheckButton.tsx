'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { MissionsApiError, type MissionCheckResult, type MissionStepView } from '@web/lib/missions-api';
import { missionErrorMessage } from './student-mission-errors';

export type ManualCheckButtonProps = {
  missionId: string;
  step: MissionStepView;
  /** Called with the step and mission the API returned, only after a `2xx`. */
  onChecked: (result: MissionCheckResult) => void;
};

type Phase = 'idle' | 'confirming' | 'pending';

/**
 * *I did it* for a `manual_check` step (RFC 0022 §3.6). The check is final, so
 * the button asks for confirmation first and there is no way back once ticked.
 * A locked sequential step shows the button disabled with its reason; a
 * completed one renders nothing (the row already shows the check). A refusal
 * (`409`) leaves the step open and shows its translated reason.
 */
export function ManualCheckButton({ missionId, step, onChecked }: ManualCheckButtonProps) {
  const d = useDict().missions;
  const client = useApiClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const checkRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const hintId = useId();

  useEffect(() => {
    if (phase === 'confirming') confirmRef.current?.focus();
    else if (phase === 'idle' && wasConfirming.current) checkRef.current?.focus();
    wasConfirming.current = phase !== 'idle';
  }, [phase]);

  if (step.kind !== 'manual_check' || step.state === 'completed') return null;

  if (step.state === 'locked') {
    return (
      <div className="flex shrink-0 flex-col items-end gap-1" title={d.check.lockedHint}>
        <Button size="sm" variant="secondary" disabled aria-describedby={hintId}>
          {d.check.button}
        </Button>
        <p id={hintId} className="text-[11px]" style={{ color: 'var(--aq-text3)' }}>
          {d.check.lockedHint}
        </p>
      </div>
    );
  }

  const check = async () => {
    if (phase === 'pending') return;
    setPhase('pending');
    setError(null);
    try {
      const result = await client.missions.check(missionId, step.id);
      onChecked(result);
    } catch (err: unknown) {
      const closed = err instanceof MissionsApiError && err.code === 'MISSION_CLOSED';
      setError(closed ? d.check.closed : missionErrorMessage(err, d));
      setPhase('idle');
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      {phase === 'idle' ? (
        <Button
          ref={checkRef}
          size="sm"
          variant="primary"
          aria-label={d.check.buttonLabel(step.title)}
          onClick={() => {
            setError(null);
            setPhase('confirming');
          }}
        >
          {d.check.button}
        </Button>
      ) : (
        <div role="group" aria-label={d.check.confirmLabel(step.title)} className="flex max-w-[12rem] flex-col gap-2 sm:max-w-xs">
          <p className="text-xs" style={{ color: 'var(--aq-text2)' }}>
            {d.check.confirmPrompt}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button ref={confirmRef} size="sm" variant="primary" isLoading={phase === 'pending'} onClick={check}>
              {phase === 'pending' ? d.check.pending : d.check.confirm}
            </Button>
            <Button size="sm" variant="secondary" disabled={phase === 'pending'} onClick={() => setPhase('idle')}>
              {d.check.cancel}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="max-w-[12rem] text-right text-xs sm:max-w-xs" style={{ color: 'var(--aq-error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
