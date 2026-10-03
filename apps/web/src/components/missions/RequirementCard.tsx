'use client';

import { useId, type DragEvent } from 'react';
import {
  MANUAL_CHECK_INSTRUCTIONS_MAX,
  REQUIREMENT_MIN_COUNT_MAX,
  REQUIREMENT_TITLE_MAX,
} from '@arenaquest/shared/domain/missions/requirements';
import { useDict } from '@web/context/dict-context';
import type { AdminEvent } from '@web/lib/admin-events-api';
import type { MissionMode } from '@web/lib/admin-gamification-api';
import type { TopicNode } from '@web/lib/admin-topics-api';
import { EventPicker } from './EventPicker';
import { SingleTopicPicker } from './SingleTopicPicker';
import type { StepDraft } from './mission-draft';
import type { TopicMediaStat } from './use-topic-media-stats';
import {
  errorStyle,
  eyebrowClass,
  eyebrowStyle,
  fieldClass,
  fieldStyle,
  hintClass,
  hintStyle,
  labelClass,
  labelStyle,
} from './form-styles';

export type RequirementCardProps = {
  index: number;
  total: number;
  step: StepDraft;
  mode: MissionMode;
  /** Kind, target, params, XP and order are locked (after start, or read-only). */
  structureLocked: boolean;
  /** The title is locked too (content creator). */
  titleLocked: boolean;
  error?: string;
  /** The XP was pre-filled above the matching private step's. */
  sharedXpPrefilled?: boolean;
  topics: TopicNode[];
  events: AdminEvent[];
  eventPriced: Record<string, boolean>;
  mediaStat?: TopicMediaStat;
  onChange: (patch: Partial<StepDraft>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onDragStart: (e: DragEvent<HTMLLIElement>) => void;
  onDrop: (e: DragEvent<HTMLLIElement>) => void;
};

/** One step of the mission: its kind's fields, XP, ordering and removal. */
export function RequirementCard({
  index,
  total,
  step,
  mode,
  structureLocked,
  titleLocked,
  error,
  sharedXpPrefilled = false,
  topics,
  events,
  eventPriced,
  mediaStat,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragStart,
  onDrop,
}: RequirementCardProps) {
  const d = useDict().admin.missions.requirements;
  const uid = useId();
  const ids = {
    title: `${uid}-title`,
    xp: `${uid}-xp`,
    minCount: `${uid}-min`,
    instructions: `${uid}-instructions`,
    event: `${uid}-event`,
    error: `${uid}-error`,
  };
  const n = index + 1;
  const sequential = mode === 'sequential';
  const hasTopic = step.kind === 'submissions_on_topic' || step.kind === 'topic_visited' || step.kind === 'video_watched';
  const hasMinCount = step.kind === 'submissions_on_topic' || step.kind === 'video_watched';
  const videoCap =
    step.kind === 'video_watched' && mediaStat?.status === 'ready' ? mediaStat.videos : undefined;
  const minCountMax = Math.max(1, Math.min(REQUIREMENT_MIN_COUNT_MAX, videoCap ?? REQUIREMENT_MIN_COUNT_MAX));

  const iconButton =
    'inline-flex h-8 w-8 items-center justify-center rounded-lg border text-sm transition-colors duration-200 hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[oklch(0.74_0.19_52_/_0.12)] disabled:cursor-not-allowed disabled:opacity-40';
  const iconButtonStyle = { borderColor: 'var(--border2)', background: 'var(--bg3)', color: 'var(--text2)' };

  return (
    <li
      data-testid="requirement-card"
      aria-label={d.stepNumber(n)}
      aria-describedby={error ? ids.error : undefined}
      draggable={!structureLocked}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        if (!structureLocked) e.preventDefault();
      }}
      onDrop={onDrop}
      className="rounded-xl border p-4"
      style={{
        background: 'var(--bg2)',
        borderColor: error ? 'var(--error)' : 'var(--border)',
        boxShadow: error ? '0 0 0 3px var(--error-bg)' : undefined,
      }}
    >
      <div className="mb-3 flex items-center gap-3">
        {!structureLocked && (
          <span
            aria-label={d.dragHandle(n)}
            role="img"
            className="cursor-grab select-none text-sm"
            style={{ color: 'var(--text3)' }}
          >
            ⠿
          </span>
        )}
        {sequential && (
          <span
            data-testid="step-number"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
            style={{
              background: 'var(--accent-glow)',
              color: 'var(--accent)',
              fontFamily: "'Space Grotesk', sans-serif",
            }}
          >
            {n}
          </span>
        )}
        <span className={`${eyebrowClass} flex-1`} style={eyebrowStyle}>
          {d.kinds[step.kind]}
        </span>
        {!structureLocked && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={d.moveUp(n)}
              onClick={onMoveUp}
              disabled={index === 0}
              className={iconButton}
              style={iconButtonStyle}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={d.moveDown(n)}
              onClick={onMoveDown}
              disabled={index === total - 1}
              className={iconButton}
              style={iconButtonStyle}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={d.remove(n)}
              onClick={onRemove}
              className={`${iconButton} hover:border-[color:var(--error)] hover:text-[color:var(--error)]`}
              style={iconButtonStyle}
            >
              ✕
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
        <div>
          <label htmlFor={ids.title} className={labelClass} style={labelStyle}>
            {d.fields.title}
          </label>
          <input
            id={ids.title}
            value={step.title}
            maxLength={REQUIREMENT_TITLE_MAX}
            onChange={(e) => onChange({ title: e.target.value })}
            disabled={titleLocked}
            className={fieldClass}
            style={fieldStyle}
          />
        </div>
        <div>
          <label htmlFor={ids.xp} className={labelClass} style={labelStyle}>
            {d.fields.xpReward}
          </label>
          <input
            id={ids.xp}
            type="number"
            min={0}
            step={1}
            value={step.xpReward}
            onChange={(e) => onChange({ xpReward: e.target.value })}
            disabled={structureLocked}
            className={fieldClass}
            style={fieldStyle}
          />
        </div>
      </div>
      {sharedXpPrefilled && (
        <p className={hintClass} style={hintStyle}>
          {d.sharedXpHint}
        </p>
      )}

      {hasTopic && (
        <fieldset className="mt-3">
          <legend className={labelClass} style={labelStyle}>
            {d.fields.topic}
          </legend>
          <SingleTopicPicker
            topics={topics}
            value={step.topicId}
            onChange={(topicId) => onChange({ topicId })}
            disabled={structureLocked}
          />
        </fieldset>
      )}

      {step.kind === 'topic_visited' && (
        <div className="mt-2 space-y-1">
          <p className={hintClass} style={hintStyle}>
            {d.visitHint}
          </p>
          {step.topicId && mediaStat?.status === 'loading' && (
            <p className={hintClass} style={hintStyle}>
              {d.mediaLoading}
            </p>
          )}
          {step.topicId && mediaStat?.status === 'ready' && mediaStat.media === 0 && (
            <p role="status" className="text-xs" style={{ color: 'var(--accent)' }}>
              {d.noMediaWarning}
            </p>
          )}
        </div>
      )}

      {hasMinCount && (
        <div className="mt-3 max-w-[12rem]">
          <label htmlFor={ids.minCount} className={labelClass} style={labelStyle}>
            {d.fields.minCount}
          </label>
          <input
            id={ids.minCount}
            type="number"
            min={1}
            max={minCountMax}
            step={1}
            value={step.minCount}
            onChange={(e) => onChange({ minCount: e.target.value })}
            disabled={structureLocked}
            className={fieldClass}
            style={fieldStyle}
          />
          {step.kind === 'video_watched' && step.topicId && mediaStat?.status === 'loading' && (
            <p className={hintClass} style={hintStyle}>
              {d.mediaLoading}
            </p>
          )}
          {videoCap !== undefined && step.topicId && (
            <p className={hintClass} style={hintStyle}>
              {d.videoCount(videoCap)}
            </p>
          )}
        </div>
      )}

      {step.kind === 'submissions_on_topic' && (
        <div className="mt-3 space-y-2">
          <fieldset disabled={structureLocked} className="space-y-1">
            <legend className={labelClass} style={labelStyle}>
              {d.fields.visibility}
            </legend>
            <div className="flex flex-wrap gap-4">
              {(['any', 'shared_only'] as const).map((visibility) => (
                <label key={visibility} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                  <input
                    type="radio"
                    name={`${uid}-visibility`}
                    value={visibility}
                    checked={step.visibility === visibility}
                    onChange={() => onChange({ visibility })}
                    className="accent-[color:var(--accent)]"
                  />
                  {visibility === 'any' ? d.fields.visibilityAny : d.fields.visibilitySharedOnly}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={step.requireDescription}
              onChange={(e) => onChange({ requireDescription: e.target.checked })}
              disabled={structureLocked}
              className="accent-[color:var(--accent)]"
            />
            {d.fields.requireDescription}
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={step.countModerated}
              onChange={(e) => onChange({ countModerated: e.target.checked })}
              disabled={structureLocked}
              className="accent-[color:var(--accent)]"
            />
            {d.fields.countModerated}
          </label>
        </div>
      )}

      {step.kind === 'manual_check' && (
        <div className="mt-3">
          <label htmlFor={ids.instructions} className={labelClass} style={labelStyle}>
            {d.fields.instructions}
          </label>
          <textarea
            id={ids.instructions}
            rows={3}
            maxLength={MANUAL_CHECK_INSTRUCTIONS_MAX}
            value={step.instructions}
            onChange={(e) => onChange({ instructions: e.target.value })}
            disabled={structureLocked}
            className={fieldClass}
            style={fieldStyle}
          />
        </div>
      )}

      {step.kind === 'event_participation' && (
        <div className="mt-3">
          <label htmlFor={ids.event} className={labelClass} style={labelStyle}>
            {d.fields.event}
          </label>
          <EventPicker
            id={ids.event}
            events={events}
            priced={eventPriced}
            value={step.eventId}
            onChange={(eventId) => onChange({ eventId })}
            disabled={structureLocked}
          />
        </div>
      )}

      {error && (
        <p id={ids.error} role="alert" className="mt-3 text-xs" style={errorStyle}>
          {error}
        </p>
      )}
    </li>
  );
}
