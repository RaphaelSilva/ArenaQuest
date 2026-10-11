'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useDict } from '@web/context/dict-context';
import type { MissionStepView } from '@web/lib/missions-api';
import { stepTargetView } from './step-target';

export type MissionStepRowProps = {
  step: MissionStepView;
  /** Show the step number (sequential missions). */
  numbered: boolean;
  /** Dashboard density: one line per step, the self-check shown as a hint. */
  compact?: boolean;
  /** Extra control rendered at the end of the row (e.g. the mission page's check button). */
  action?: ReactNode;
};

function StateMarker({ step }: { step: MissionStepView }) {
  const d = useDict().missions.steps;

  if (step.state === 'completed') {
    return (
      <span
        role="img"
        aria-label={d.completed}
        data-state="completed"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        style={{ background: 'var(--aq-accent3-glow)', color: 'var(--aq-accent3)' }}
      >
        ✓
      </span>
    );
  }
  if (step.state === 'locked') {
    return (
      <span
        role="img"
        aria-label={d.locked}
        data-state="locked"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px]"
        style={{ background: 'var(--aq-bg4)', color: 'var(--aq-text3)' }}
      >
        🔒
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={d.progress(step.current, step.required)}
      data-state="open"
      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
      style={{ background: 'var(--aq-accent-glow)', color: 'var(--aq-accent)' }}
    >
      {d.counter(step.current, step.required)}
    </span>
  );
}

/** One step: state marker, optional number, title, target (link or redacted), XP. */
export function MissionStepRow({ step, numbered, compact = false, action }: MissionStepRowProps) {
  const dict = useDict().missions;
  const d = dict.steps;
  const target = stepTargetView(step);
  const muted = step.state === 'locked';

  return (
    <li data-testid="mission-step" data-state={step.state} className="flex items-start gap-2">
      <StateMarker step={step} />
      <div className="min-w-0 flex-1">
        <p
          className={`text-xs font-medium ${compact ? 'truncate' : ''}`}
          style={{ color: muted ? 'var(--aq-text3)' : 'var(--aq-text)' }}
        >
          {numbered && (
            <span data-testid="mission-step-number" className="mr-1" style={{ color: 'var(--aq-text3)' }}>
              {d.number(step.position)}
            </span>
          )}
          {step.title}
        </p>

        {target.kind === 'link' && (
          <Link
            href={target.href}
            className={`block text-[11px] underline-offset-2 hover:underline ${compact ? 'truncate' : ''}`}
            style={{ color: 'var(--aq-accent)' }}
          >
            {target.title ?? d.openTarget}
          </Link>
        )}
        {target.kind === 'text' && (
          <p className={`text-[11px] ${compact ? 'truncate' : ''}`} style={{ color: 'var(--aq-text3)' }}>
            {target.title}
          </p>
        )}
        {target.kind === 'restricted' && (
          <p data-testid="mission-step-restricted" className="text-[11px] italic" style={{ color: 'var(--aq-text3)' }}>
            {d.restricted}
          </p>
        )}
        {step.kind === 'manual_check' &&
          (compact ? (
            <p className="truncate text-[11px]" style={{ color: 'var(--aq-text3)' }}>
              {d.selfCheck}
            </p>
          ) : (
            step.instructions && (
              <p className="whitespace-pre-line text-[11px]" style={{ color: 'var(--aq-text2)' }}>
                {step.instructions}
              </p>
            )
          ))}
      </div>
      <span className="shrink-0 text-[11px] font-semibold" style={{ color: 'var(--aq-text3)' }}>
        {dict.card.xp(step.xpReward)}
      </span>
      {action}
    </li>
  );
}
