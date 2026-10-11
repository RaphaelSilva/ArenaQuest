'use client';

import type { ReactNode } from 'react';
import { useDict } from '@web/context/dict-context';
import type { MissionMode, MissionStepView } from '@web/lib/missions-api';
import { MissionStepRow } from './MissionStepRow';

export type MissionStepListProps = {
  /** Mission title, for the list's accessible name. */
  title: string;
  /** The mission's `mode`: sequential missions number their steps. */
  mode: MissionMode;
  /** The steps in the order the API returned them. */
  steps: MissionStepView[];
  compact?: boolean;
  /** Per-step extra control (the mission page's *I did it*). */
  renderAction?: (step: MissionStepView) => ReactNode;
};

/**
 * The steps of a mission as the server evaluated them. State (locked, open,
 * completed) and target redaction are rendered, never derived here.
 */
export function MissionStepList({ title, mode, steps, compact = false, renderAction }: MissionStepListProps) {
  const d = useDict().missions.steps;
  if (steps.length === 0) return null;

  return (
    <ol aria-label={d.listLabel(title)} className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-3'}`}>
      {steps.map((step) => (
        <MissionStepRow
          key={step.id}
          step={step}
          numbered={mode === 'sequential'}
          compact={compact}
          action={renderAction?.(step)}
        />
      ))}
    </ol>
  );
}
