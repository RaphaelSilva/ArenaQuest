'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import type { DashboardMissionEntry } from '@web/lib/missions-api';
import { missionErrorMessage } from './student-mission-errors';

export type JoinMissionButtonProps = {
  missionId: string;
  /** Mission title, for the buttons' accessible names. */
  title: string;
  /** Called with the entry the API returned, only after a `2xx`. */
  onJoined: (entry: DashboardMissionEntry) => void;
};

type Phase = 'idle' | 'confirming' | 'pending';

/**
 * *Join* behind an inline confirmation that only activity from now on counts
 * (RFC 0022 §7). The caller applies the returned entry only after a `2xx`; a
 * refusal (`409 MISSION_CLOSED`, …) shows its translated reason under the button.
 */
export function JoinMissionButton({ missionId, title, onJoined }: JoinMissionButtonProps) {
  const d = useDict().missions;
  const client = useApiClient();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const joinRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (phase === 'confirming') confirmRef.current?.focus();
    else if (phase === 'idle' && wasConfirming.current) joinRef.current?.focus();
    wasConfirming.current = phase !== 'idle';
  }, [phase]);

  const join = async () => {
    if (phase === 'pending') return;
    setPhase('pending');
    setError(null);
    try {
      const { entry } = await client.missions.join(missionId);
      onJoined(entry);
    } catch (err: unknown) {
      setError(missionErrorMessage(err, d));
      setPhase('idle');
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {phase === 'idle' ? (
        <Button
          ref={joinRef}
          size="sm"
          variant="primary"
          aria-label={d.join.buttonLabel(title)}
          onClick={() => {
            setError(null);
            setPhase('confirming');
          }}
        >
          {d.join.button}
        </Button>
      ) : (
        <div role="group" aria-label={d.join.confirmLabel(title)} className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: 'var(--aq-text2)' }}>
            {d.join.confirmPrompt}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button ref={confirmRef} size="sm" variant="primary" isLoading={phase === 'pending'} onClick={join}>
              {phase === 'pending' ? d.join.pending : d.join.confirm}
            </Button>
            <Button size="sm" variant="secondary" disabled={phase === 'pending'} onClick={() => setPhase('idle')}>
              {d.join.cancel}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs" style={{ color: 'var(--aq-error)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
