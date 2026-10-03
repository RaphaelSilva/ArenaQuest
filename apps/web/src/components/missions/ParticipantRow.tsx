'use client';

import { useDict } from '@web/context/dict-context';
import { TableCell, TableRow } from '@web/components/design-system';
import type { MissionParticipant } from '@web/lib/admin-gamification-api';
import { StepChip } from './StepChip';
import { dayOf, type StepChipModel } from './participant-chips';

type Props = {
  participant: MissionParticipant;
  chips: StepChipModel[];
};

/** One enrolled student: identity, enrollment source, join date, left marker, step chips, completion. */
export function ParticipantRow({ participant, chips }: Props) {
  const d = useDict().admin.missions.participants;
  const label = participant.name ?? participant.email ?? d.unknownStudent;
  const progress = participant.progress;

  return (
    <TableRow isHoverable={false}>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium" style={{ color: 'var(--text)' }}>
            {label}
          </span>
          {participant.name && participant.email && (
            <span className="text-xs" style={{ color: 'var(--text3)' }}>
              {participant.email}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span className="text-sm" style={{ color: 'var(--text2)' }}>
          {d.sources[participant.source]}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1 text-sm" style={{ color: 'var(--text2)' }}>
          <span>{dayOf(participant.joinedAt)}</span>
          {participant.leftAt && (
            <span
              data-testid="left-marker"
              title={d.leftOn(dayOf(participant.leftAt))}
              className="text-xs font-semibold"
              style={{ color: 'var(--error)' }}
            >
              {d.leftMarker}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        {chips.length === 0 ? (
          <span className="text-xs" style={{ color: 'var(--text3)' }}>
            {d.noSteps}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <StepChip key={chip.requirementId} chip={chip} />
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <span
          className="text-sm"
          data-testid="mission-completion"
          style={{ color: progress?.completed ? 'var(--accent3)' : 'var(--text3)' }}
        >
          {progress?.completed
            ? progress.completedAt
              ? d.completedOn(dayOf(progress.completedAt))
              : d.completedLabel
            : d.notCompleted}
        </span>
      </TableCell>
    </TableRow>
  );
}
