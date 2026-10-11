import { describe, it, expect } from 'vitest';
import { RequirementInputList } from '@arenaquest/shared/domain/missions/requirements';
import {
  emptyDraft,
  emptyStep,
  sharedStepXp,
  toCreateInput,
  toPatchInput,
  validateMission,
  validateSteps,
  type MissionDraft,
} from '../mission-draft';
import { shouldSuggestBadge } from '../BadgeHint';

const TOPIC = '11111111-1111-4111-8111-111111111111';
const noVideos = () => undefined;

describe('mission-draft', () => {
  it('sharedStepXp is always higher than the private XP', () => {
    expect(sharedStepXp(0)).toBe(10);
    expect(sharedStepXp(40)).toBe(60);
    expect(sharedStepXp(100)).toBe(150);
  });

  it('validates steps with the shared schema and reports the field per index', () => {
    const ok = { ...emptyStep('manual_check'), title: 'Bow in' };
    const noTopic = { ...emptyStep('topic_visited'), title: 'Visit' };
    const badCount = { ...emptyStep('submissions_on_topic'), title: 'Demo', topicId: TOPIC, minCount: '99' };
    const noTitle = { ...emptyStep('manual_check') };
    const result = validateSteps([ok, noTopic, badCount, noTitle], noVideos);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual({
      1: { code: 'topic' },
      2: { code: 'minCount' },
      3: { code: 'title' },
    });
  });

  it('caps a video step at the known video count', () => {
    const video = { ...emptyStep('video_watched'), title: 'Watch', topicId: TOPIC, minCount: '3' };
    const result = validateSteps([video], () => 2);
    expect(result).toEqual({ ok: false, issues: { 0: { code: 'videoCap', count: 2 } } });
    expect(validateSteps([video], noVideos).ok).toBe(true);
  });

  it('builds a create body with only the kind fields and the audience only when assigned', () => {
    const draft: MissionDraft = {
      ...emptyDraft(),
      title: ' Kihon month ',
      description: 'Three demonstrations.',
      startAt: '2026-11-01T10:00',
      endAt: '2026-11-30T10:00',
      mode: 'sequential',
      xpReward: '300',
      audience: { groupIds: ['g1'], userIds: [] },
      steps: [{ ...emptyStep('submissions_on_topic'), title: 'Demo', topicId: TOPIC, minCount: '3', xpReward: '50' }],
    };
    const result = validateSteps(draft.steps, noVideos);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const body = toCreateInput(draft, result.inputs);
    expect(body).toEqual({
      title: 'Kihon month',
      description: 'Three demonstrations.',
      startAt: new Date('2026-11-01T10:00').toISOString(),
      endAt: new Date('2026-11-30T10:00').toISOString(),
      mode: 'sequential',
      enrollmentMode: 'auto',
      xpReward: 300,
      badgeId: null,
      requirements: [
        {
          kind: 'submissions_on_topic',
          title: 'Demo',
          xpReward: 50,
          topicId: TOPIC,
          params: { minCount: 3, requireDescription: false, visibility: 'any', countModerated: false },
        },
      ],
    });
    expect(RequirementInputList.safeParse(body.requirements).success).toBe(true);
    expect(toCreateInput({ ...draft, enrollmentMode: 'assigned' }, result.inputs).audience).toEqual({
      groupIds: ['g1'],
      userIds: [],
    });
  });

  it('validates the mission card', () => {
    const base = { ...emptyDraft(), title: 'T', description: 'D', startAt: '2026-11-01T10:00', endAt: '2026-11-02T10:00' };
    expect(validateMission({ ...base, title: ' ' })).toBe('title');
    expect(validateMission({ ...base, endAt: '' })).toBe('window');
    expect(validateMission({ ...base, endAt: '2026-10-01T10:00' })).toBe('windowOrder');
    expect(validateMission(base)).toBe('steps');
    expect(validateMission({ ...base, steps: [emptyStep('manual_check')] })).toBeNull();
  });

  it('patches only changed fields, and never the locked ones once started', () => {
    const original = { ...emptyDraft(), title: 'A', description: 'D', startAt: '2026-11-01T10:00', endAt: '2026-11-02T10:00' };
    const edited = { ...original, title: 'B', mode: 'sequential' as const, xpReward: '10' };
    expect(toPatchInput(edited, original, false)).toEqual({ title: 'B', mode: 'sequential', xpReward: 10 });
    expect(toPatchInput(edited, original, true)).toEqual({ title: 'B' });
  });

  it('suggests a badge for a window of 14 days or more with no badge', () => {
    const base = { startAt: '2026-11-01T10:00', endAt: '2026-11-15T10:00', badgeId: '' };
    expect(shouldSuggestBadge(base)).toBe(true);
    expect(shouldSuggestBadge({ ...base, endAt: '2026-11-15T09:59' })).toBe(false);
    expect(shouldSuggestBadge({ ...base, badgeId: 'b1' })).toBe(false);
    expect(shouldSuggestBadge({ ...base, endAt: '' })).toBe(false);
  });
});
