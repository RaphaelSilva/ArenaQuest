'use client';

import { useId } from 'react';
import { useDict } from '@web/context/dict-context';
import type { Badge, MissionEnrollmentMode, MissionMode } from '@web/lib/admin-gamification-api';
import { BadgeHint } from './BadgeHint';
import { MissionAudiencePicker } from './MissionAudiencePicker';
import type { MissionDraft } from './mission-draft';
import {
  cardClass,
  cardStyle,
  eyebrowClass,
  eyebrowStyle,
  fieldClass,
  fieldStyle,
  hintClass,
  hintStyle,
  labelClass,
  labelStyle,
} from './form-styles';

const MODES: MissionMode[] = ['parallel', 'sequential'];
const ENROLLMENT_MODES: MissionEnrollmentMode[] = ['auto', 'open', 'assigned'];

type Props = {
  draft: MissionDraft;
  onChange: (patch: Partial<MissionDraft>) => void;
  badges: Badge[];
  /** Nothing is editable (content creator). */
  readOnly: boolean;
  /** The mission started: only title, description, extending the end and active stay editable. */
  started: boolean;
  /** Creating: there is no active switch (a new mission is always active). */
  isNew: boolean;
  /** The stored end (`datetime-local`), the floor of an extension once started. */
  originalEndAt: string;
};

/**
 * The mission card: title, description, window, mode, enrollment (with the
 * audience picker for *Assigned*), mission XP and badge (with the 14-day hint).
 */
export function MissionForm({ draft, onChange, badges, readOnly, started, isNew, originalEndAt }: Props) {
  const d = useDict().admin.missions;
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const locked = readOnly || started;

  return (
    <div className="space-y-6">
      <section className={`${cardClass} space-y-4`} style={cardStyle}>
        <h2 className={eyebrowClass} style={eyebrowStyle}>
          {d.sections.mission}
        </h2>

        <div>
          <label htmlFor={id('title')} className={labelClass} style={labelStyle}>
            {d.fields.title}
          </label>
          <input
            id={id('title')}
            value={draft.title}
            maxLength={120}
            onChange={(e) => onChange({ title: e.target.value })}
            disabled={readOnly}
            required
            className={fieldClass}
            style={fieldStyle}
          />
        </div>

        <div>
          <label htmlFor={id('description')} className={labelClass} style={labelStyle}>
            {d.fields.description}
          </label>
          <textarea
            id={id('description')}
            rows={3}
            maxLength={2000}
            value={draft.description}
            onChange={(e) => onChange({ description: e.target.value })}
            disabled={readOnly}
            required
            className={fieldClass}
            style={fieldStyle}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={id('start')} className={labelClass} style={labelStyle}>
              {d.fields.startAt}
            </label>
            <input
              id={id('start')}
              type="datetime-local"
              value={draft.startAt}
              onChange={(e) => onChange({ startAt: e.target.value })}
              disabled={locked}
              required
              className={fieldClass}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor={id('end')} className={labelClass} style={labelStyle}>
              {d.fields.endAt}
            </label>
            <input
              id={id('end')}
              type="datetime-local"
              value={draft.endAt}
              min={started ? originalEndAt : draft.startAt || undefined}
              onChange={(e) => onChange({ endAt: e.target.value })}
              disabled={readOnly}
              required
              className={fieldClass}
              style={fieldStyle}
            />
            {started && !readOnly && (
              <p className={hintClass} style={hintStyle}>
                {d.fields.endAtStartedHint}
              </p>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset disabled={locked} className="space-y-2">
            <legend className={labelClass} style={labelStyle}>
              {d.fields.mode}
            </legend>
            {MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="radio"
                  name={id('mode')}
                  value={mode}
                  checked={draft.mode === mode}
                  onChange={() => onChange({ mode })}
                  className="accent-[color:var(--accent)]"
                />
                {d.modeOptions[mode]}
              </label>
            ))}
          </fieldset>

          <fieldset disabled={locked} className="space-y-2">
            <legend className={labelClass} style={labelStyle}>
              {d.fields.enrollment}
            </legend>
            {ENROLLMENT_MODES.map((mode) => (
              <label key={mode} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text)' }}>
                <input
                  type="radio"
                  name={id('enrollment')}
                  value={mode}
                  checked={draft.enrollmentMode === mode}
                  onChange={() => onChange({ enrollmentMode: mode })}
                  className="mt-1 accent-[color:var(--accent)]"
                />
                <span>
                  <span className="block">{d.enrollmentOptions[mode]}</span>
                  <span className="block text-xs" style={hintStyle}>
                    {d.enrollmentHints[mode]}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={id('xp')} className={labelClass} style={labelStyle}>
              {d.fields.xpReward}
            </label>
            <input
              id={id('xp')}
              type="number"
              min={0}
              step={1}
              value={draft.xpReward}
              onChange={(e) => onChange({ xpReward: e.target.value })}
              disabled={locked}
              className={fieldClass}
              style={fieldStyle}
            />
          </div>
          <div>
            <label htmlFor={id('badge')} className={labelClass} style={labelStyle}>
              {d.fields.badge}
            </label>
            <select
              id={id('badge')}
              value={draft.badgeId}
              onChange={(e) => onChange({ badgeId: e.target.value })}
              disabled={locked}
              className={fieldClass}
              style={fieldStyle}
            >
              <option value="">{d.noBadge}</option>
              {badges.map((badge) => (
                <option key={badge.id} value={badge.id}>
                  {badge.name}
                </option>
              ))}
            </select>
            {!locked && <BadgeHint startAt={draft.startAt} endAt={draft.endAt} badgeId={draft.badgeId} />}
          </div>
        </div>

        {!isNew && (
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text)' }}>
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              disabled={readOnly}
              className="accent-[color:var(--accent)]"
            />
            {d.fields.active}
          </label>
        )}
      </section>

      {draft.enrollmentMode === 'assigned' && (
        <section className={`${cardClass} space-y-3`} style={cardStyle}>
          <h2 className={eyebrowClass} style={eyebrowStyle}>
            {d.sections.audience}
          </h2>
          <MissionAudiencePicker
            value={draft.audience}
            onChange={(audience) => onChange({ audience })}
            disabled={locked}
          />
        </section>
      )}
    </div>
  );
}
