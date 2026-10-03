'use client';

import { useId, useRef, useState } from 'react';
import {
  MISSION_STEPS_MAX,
  REQUIREMENT_KINDS,
  type RequirementKind,
} from '@arenaquest/shared/domain/missions/requirements';
import { useDict } from '@web/context/dict-context';
import { Button } from '@web/components/design-system';
import type { AdminEvent } from '@web/lib/admin-events-api';
import type { MissionMode } from '@web/lib/admin-gamification-api';
import type { TopicNode } from '@web/lib/admin-topics-api';
import { RequirementCard } from './RequirementCard';
import { emptyStep, prefillSharedXp, type StepDraft } from './mission-draft';
import type { TopicMediaStat } from './use-topic-media-stats';
import { fieldClass, fieldStyle, hintClass, hintStyle, labelClass, labelStyle } from './form-styles';

type Props = {
  steps: StepDraft[];
  onChange: (steps: StepDraft[]) => void;
  mode: MissionMode;
  /** No add, remove, reorder or field change (after start, or read-only). */
  structureLocked: boolean;
  /** Titles are locked too (content creator). */
  titleLocked: boolean;
  /** Error per step index (client validation or the API's `index`). */
  errors: Record<number, string>;
  topics: TopicNode[];
  events: AdminEvent[];
  eventPriced: Record<string, boolean>;
  mediaStats: Record<string, TopicMediaStat>;
};

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * The ordered step list of a mission: **Add step** with a kind picker, one card
 * per step, and reordering by drag (native HTML5) or by the keyboard-reachable
 * up/down buttons. Positions are the array order; numbers show only in
 * sequential mode, where the order is what the student walks through.
 */
export function RequirementEditor({
  steps,
  onChange,
  mode,
  structureLocked,
  titleLocked,
  errors,
  topics,
  events,
  eventPriced,
  mediaStats,
}: Props) {
  const d = useDict().admin.missions.requirements;
  const kindId = useId();
  const [newKind, setNewKind] = useState<RequirementKind>('submissions_on_topic');
  const [prefilled, setPrefilled] = useState<ReadonlySet<string>>(new Set());
  const dragFrom = useRef<number | null>(null);
  const full = steps.length >= MISSION_STEPS_MAX;

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    const next = steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
    const key = next[index].key;
    const marks = new Set(prefilled);
    if ('xpReward' in patch) marks.delete(key);
    if ('visibility' in patch || 'topicId' in patch) {
      const xp = prefillSharedXp(next, index);
      if (xp !== null) {
        next[index] = { ...next[index], xpReward: String(xp) };
        marks.add(key);
      }
    }
    setPrefilled(marks);
    onChange(next);
  };

  const addStep = () => {
    if (full) return;
    onChange([...steps, emptyStep(newKind)]);
  };

  return (
    <div className="space-y-3">
      {steps.length === 0 ? (
        <p className="text-sm" style={hintStyle}>
          {d.empty}
        </p>
      ) : (
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <RequirementCard
              key={step.key}
              index={index}
              total={steps.length}
              step={step}
              mode={mode}
              structureLocked={structureLocked}
              titleLocked={titleLocked}
              error={errors[index]}
              sharedXpPrefilled={prefilled.has(step.key)}
              topics={topics}
              events={events}
              eventPriced={eventPriced}
              mediaStat={step.topicId ? mediaStats[step.topicId] : undefined}
              onChange={(patch) => updateStep(index, patch)}
              onMoveUp={() => onChange(move(steps, index, index - 1))}
              onMoveDown={() => onChange(move(steps, index, index + 1))}
              onRemove={() => onChange(steps.filter((_, i) => i !== index))}
              onDragStart={(e) => {
                dragFrom.current = index;
                if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom.current;
                dragFrom.current = null;
                if (from !== null && !structureLocked) onChange(move(steps, from, index));
              }}
            />
          ))}
        </ol>
      )}

      {!structureLocked && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1 sm:flex-none">
            <label htmlFor={kindId} className={labelClass} style={labelStyle}>
              {d.kindPicker}
            </label>
            <select
              id={kindId}
              value={newKind}
              onChange={(e) => setNewKind(e.target.value as RequirementKind)}
              disabled={full}
              className={fieldClass}
              style={fieldStyle}
            >
              {REQUIREMENT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {d.kinds[kind]}
                </option>
              ))}
            </select>
          </div>
          <Button type="button" variant="secondary" size="md" onClick={addStep} disabled={full}>
            {d.addStep}
          </Button>
          {full && (
            <p className={hintClass} style={hintStyle}>
              {d.maxReached(MISSION_STEPS_MAX)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
