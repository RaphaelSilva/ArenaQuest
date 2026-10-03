import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { Mission, MissionProgress } from '../mission';
import type { DashboardMissionEntry } from '../../types/dashboard';
import {
  MANUAL_CHECK_INSTRUCTIONS_MAX,
  MISSION_STEPS_MAX,
  MissionEnrollmentMode,
  MissionMode,
  REQUIREMENT_KINDS,
  REQUIREMENT_MIN_COUNT_MAX,
  REQUIREMENT_TITLE_MAX,
  RequirementInput,
  RequirementInputList,
  parseRequirementParams,
  targetCountOf,
} from './requirements';

const TOPIC_ID = '7b0c1f3e-2a4d-4c5e-9f60-1a2b3c4d5e6f';
const EVENT_ID = '3d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';

/** The smallest valid input of every kind. */
const MINIMAL: Record<(typeof REQUIREMENT_KINDS)[number], Record<string, unknown>> = {
  submissions_on_topic: { kind: 'submissions_on_topic', title: 'Upload 3', topicId: TOPIC_ID, params: { minCount: 3 } },
  topic_visited: { kind: 'topic_visited', title: 'Visit', topicId: TOPIC_ID },
  video_watched: { kind: 'video_watched', title: 'Watch 2', topicId: TOPIC_ID, params: { minCount: 2 } },
  manual_check: { kind: 'manual_check', title: 'Practice at home' },
  event_participation: { kind: 'event_participation', title: 'Attend', eventId: EVENT_ID },
};

const rejects = (input: unknown): boolean => !RequirementInput.safeParse(input).success;

describe('mission requirement limits (RFC 0022 section 2)', () => {
  // Spelled as literals so a changed limit fails here instead of shipping.
  it('keeps the five kinds and the limits', () => {
    expect(REQUIREMENT_KINDS).toEqual([
      'submissions_on_topic',
      'topic_visited',
      'video_watched',
      'manual_check',
      'event_participation',
    ]);
    expect(MISSION_STEPS_MAX).toBe(20);
    expect(REQUIREMENT_TITLE_MAX).toBe(120);
    expect(REQUIREMENT_MIN_COUNT_MAX).toBe(50);
    expect(MANUAL_CHECK_INSTRUCTIONS_MAX).toBe(500);
  });

  it('exposes the mission mode and enrollment mode enums', () => {
    expect(MissionMode.options).toEqual(['parallel', 'sequential']);
    expect(MissionEnrollmentMode.options).toEqual(['auto', 'open', 'assigned']);
  });
});

describe('RequirementInput', () => {
  it.each(REQUIREMENT_KINDS)('accepts the minimal valid input of %s', (kind) => {
    const parsed = RequirementInput.parse(MINIMAL[kind]);
    expect(parsed.kind).toBe(kind);
    expect(parsed.xpReward).toBe(0);
  });

  it('applies the submissions_on_topic defaults when only minCount is given', () => {
    const parsed = RequirementInput.parse(MINIMAL.submissions_on_topic);
    expect(parsed.params).toEqual({
      minCount: 3,
      requireDescription: false,
      visibility: 'any',
      countModerated: false,
    });
  });

  it('defaults the params of the kinds that need none', () => {
    expect(RequirementInput.parse(MINIMAL.topic_visited).params).toEqual({});
    expect(RequirementInput.parse(MINIMAL.event_participation).params).toEqual({});
    expect(RequirementInput.parse(MINIMAL.manual_check).params).toEqual({ instructions: '' });
  });

  it('trims the title and keeps an explicit xpReward', () => {
    const parsed = RequirementInput.parse({ ...MINIMAL.manual_check, title: '  Stretch  ', xpReward: 25 });
    expect(parsed.title).toBe('Stretch');
    expect(parsed.xpReward).toBe(25);
  });

  it('rejects an unknown kind', () => {
    expect(rejects({ kind: 'quiz_passed', title: 'Quiz', topicId: TOPIC_ID, params: {} })).toBe(true);
  });

  it.each([0, 51, 2.5])('rejects minCount %s', (minCount) => {
    expect(rejects({ ...MINIMAL.submissions_on_topic, params: { minCount } })).toBe(true);
    expect(rejects({ ...MINIMAL.video_watched, params: { minCount } })).toBe(true);
  });

  it('accepts minCount at both bounds', () => {
    expect(rejects({ ...MINIMAL.video_watched, params: { minCount: 1 } })).toBe(false);
    expect(rejects({ ...MINIMAL.video_watched, params: { minCount: 50 } })).toBe(false);
  });

  it('rejects an extra params key on every kind', () => {
    expect(rejects({ ...MINIMAL.submissions_on_topic, params: { minCount: 3, extra: true } })).toBe(true);
    expect(rejects({ ...MINIMAL.topic_visited, params: { extra: true } })).toBe(true);
    expect(rejects({ ...MINIMAL.video_watched, params: { minCount: 2, extra: true } })).toBe(true);
    expect(rejects({ ...MINIMAL.manual_check, params: { extra: true } })).toBe(true);
    expect(rejects({ ...MINIMAL.event_participation, params: { extra: true } })).toBe(true);
  });

  it('rejects an extra top-level key', () => {
    expect(rejects({ ...MINIMAL.topic_visited, position: 1 })).toBe(true);
  });

  it('rejects a 121-character title and a blank one', () => {
    expect(rejects({ ...MINIMAL.manual_check, title: 'x'.repeat(121) })).toBe(true);
    expect(rejects({ ...MINIMAL.manual_check, title: 'x'.repeat(120) })).toBe(false);
    expect(rejects({ ...MINIMAL.manual_check, title: '   ' })).toBe(true);
  });

  it('rejects a negative or fractional xpReward', () => {
    expect(rejects({ ...MINIMAL.manual_check, xpReward: -1 })).toBe(true);
    expect(rejects({ ...MINIMAL.manual_check, xpReward: 1.5 })).toBe(true);
  });

  it('rejects manual_check instructions over 500 characters', () => {
    expect(rejects({ ...MINIMAL.manual_check, params: { instructions: 'x'.repeat(501) } })).toBe(true);
    expect(rejects({ ...MINIMAL.manual_check, params: { instructions: 'x'.repeat(500) } })).toBe(false);
  });

  it('rejects a topicId on manual_check and an eventId on a topic kind', () => {
    expect(rejects({ ...MINIMAL.manual_check, topicId: TOPIC_ID })).toBe(true);
    expect(rejects({ ...MINIMAL.video_watched, eventId: EVENT_ID })).toBe(true);
    expect(rejects({ ...MINIMAL.event_participation, topicId: TOPIC_ID })).toBe(true);
  });

  it.each(['submissions_on_topic', 'topic_visited', 'video_watched'] as const)(
    'rejects %s without a topicId',
    (kind) => {
      const { topicId: _omit, ...rest } = MINIMAL[kind];
      void _omit;
      expect(rejects(rest)).toBe(true);
    },
  );

  it('rejects event_participation without an eventId and a non-uuid target', () => {
    expect(rejects({ kind: 'event_participation', title: 'Attend' })).toBe(true);
    expect(rejects({ ...MINIMAL.topic_visited, topicId: 'not-a-uuid' })).toBe(true);
  });

  it('requires the params of the two counting kinds', () => {
    expect(rejects({ kind: 'video_watched', title: 'Watch', topicId: TOPIC_ID })).toBe(true);
    expect(rejects({ kind: 'submissions_on_topic', title: 'Upload', topicId: TOPIC_ID })).toBe(true);
  });
});

describe('RequirementInputList', () => {
  it('accepts 1 to 20 steps and rejects 0 and 21', () => {
    const step = MINIMAL.manual_check;
    expect(RequirementInputList.safeParse([]).success).toBe(false);
    expect(RequirementInputList.safeParse([step]).success).toBe(true);
    expect(RequirementInputList.safeParse(Array(MISSION_STEPS_MAX).fill(step)).success).toBe(true);
    expect(RequirementInputList.safeParse(Array(MISSION_STEPS_MAX + 1).fill(step)).success).toBe(false);
  });
});

describe('targetCountOf', () => {
  it('returns minCount for the two counting kinds and 1 for the others', () => {
    const counts = Object.fromEntries(
      REQUIREMENT_KINDS.map((kind) => [kind, targetCountOf(RequirementInput.parse(MINIMAL[kind]))]),
    );
    expect(counts).toEqual({
      submissions_on_topic: 3,
      topic_visited: 1,
      video_watched: 2,
      manual_check: 1,
      event_participation: 1,
    });
  });
});

describe('parseRequirementParams', () => {
  it('normalises stored params with the kind defaults', () => {
    expect(parseRequirementParams('submissions_on_topic', { minCount: 4, visibility: 'shared_only' })).toEqual({
      minCount: 4,
      requireDescription: false,
      visibility: 'shared_only',
      countModerated: false,
    });
    expect(parseRequirementParams('manual_check', {})).toEqual({ instructions: '' });
    expect(parseRequirementParams('topic_visited', {})).toEqual({});
  });

  it('throws a ZodError on params that do not match the kind', () => {
    expect(() => parseRequirementParams('video_watched', {})).toThrow(ZodError);
    expect(() => parseRequirementParams('topic_visited', { minCount: 1 })).toThrow(ZodError);
  });
});

describe('DashboardMissionEntry (type contract)', () => {
  it('accepts the legacy shape and the neutral RFC 0022 values', () => {
    // Compile-time check (the shared `tsc` build includes this spec): the M7 producer
    // shape still type-checks, and so does the same entry with the new fields neutral.
    const mission = { id: 'm1', title: 'Mission', mode: 'parallel', enrollmentMode: 'auto' } as Mission;
    const progress: MissionProgress | null = null;
    const legacy: DashboardMissionEntry = { mission, progress };
    const neutral: DashboardMissionEntry = { ...legacy, enrollment: null, joinable: false, locked: null, steps: [] };
    expect(neutral).toMatchObject(legacy);
  });
});
