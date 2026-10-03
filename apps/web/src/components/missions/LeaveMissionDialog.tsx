'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@web/components/design-system';
import { useApiClient } from '@web/context/auth-context';
import { useDict } from '@web/context/dict-context';
import { missionErrorMessage } from './student-mission-errors';

export type LeaveMissionDialogProps = {
  missionId: string;
  /** Mission title, for the buttons' accessible names. */
  title: string;
};

type Phase = 'idle' | 'confirming' | 'pending';

/**
 * *Leave* behind an inline confirmation that completed steps and earned XP are
 * kept and that rejoining will not reset the window (RFC 0022 §5). Only offered
 * for a `self` enrollment — the caller decides. On a `2xx` it returns to the
 * dashboard; a refusal shows its translated reason.
 */
export function LeaveMissionDialog({ missionId, title }: LeaveMissionDialogProps) {
  const d = useDict().missions;
  const client = useApiClient();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const leaveRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  useEffect(() => {
    if (phase === 'confirming') confirmRef.current?.focus();
    else if (phase === 'idle' && wasConfirming.current) leaveRef.current?.focus();
    wasConfirming.current = phase !== 'idle';
  }, [phase]);

  const leave = async () => {
    if (phase === 'pending') return;
    setPhase('pending');
    setError(null);
    try {
      await client.missions.leave(missionId);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(missionErrorMessage(err, d));
      setPhase('idle');
    }
  };

  return (
    <div className="flex flex-col items-start gap-2">
      {phase === 'idle' ? (
        <Button
          ref={leaveRef}
          size="sm"
          variant="secondary"
          aria-label={d.leave.buttonLabel(title)}
          onClick={() => {
            setError(null);
            setPhase('confirming');
          }}
        >
          {d.leave.button}
        </Button>
      ) : (
        <div role="group" aria-label={d.leave.confirmLabel(title)} className="flex flex-col gap-2">
          <p className="text-xs" style={{ color: 'var(--aq-text2)' }}>
            {d.leave.confirmPrompt}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button ref={confirmRef} size="sm" variant="danger" isLoading={phase === 'pending'} onClick={leave}>
              {phase === 'pending' ? d.leave.pending : d.leave.confirm}
            </Button>
            <Button size="sm" variant="secondary" disabled={phase === 'pending'} onClick={() => setPhase('idle')}>
              {d.leave.cancel}
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
