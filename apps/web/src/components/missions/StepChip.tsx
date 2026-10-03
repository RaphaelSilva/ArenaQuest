'use client';

import { useDict } from '@web/context/dict-context';
import { Badge } from '@web/components/design-system';
import { dayOf, type StepChipModel } from './participant-chips';

const STATUS = { locked: 'locked', open: 'inprog', completed: 'done' } as const;

/** One step of a participant: locked, open with `current/required`, or completed with its date and closer. */
export function StepChip({ chip }: { chip: StepChipModel }) {
  const d = useDict().admin.missions.participants;
  const { state } = chip;

  let label: string;
  if (state.kind === 'locked') label = d.chipLocked;
  else if (state.kind === 'open') label = d.chipOpen(state.current, state.required);
  else label = d.chipCompleted(dayOf(state.completedAt));

  const marker = state.kind === 'completed' && state.completedBy ? d.completedBy[state.completedBy] : null;

  return (
    <span
      data-testid="step-chip"
      data-state={state.kind}
      title={chip.title}
      aria-label={d.chipLabel(chip.title, label, marker)}
      className="inline-flex"
    >
      <Badge status={STATUS[state.kind]} size="sm" className="gap-1">
        <span>{label}</span>
        {marker && (
          <span data-testid="step-chip-marker" className="font-normal opacity-80">
            {marker}
          </span>
        )}
      </Badge>
    </span>
  );
}
