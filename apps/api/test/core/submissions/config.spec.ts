import { describe, expect, it } from 'vitest';
import {
  parseSubmissionConfig,
  type SubmissionConfigVar,
} from '@api/core/submissions/config';

const NUMERIC: SubmissionConfigVar[] = [
  'SUBMISSIONS_PER_TOPIC_MAX',
  'SUBMISSIONS_STORAGE_PER_STUDENT_BYTES',
  'SUBMISSIONS_VIDEO_MAX_BYTES',
];

// M23 Task 02 — absent → default, present-but-invalid → error naming the var.
describe('parseSubmissionConfig', () => {
  it('returns the defaults when every var is absent', () => {
    expect(parseSubmissionConfig({})).toEqual({
      ok: true,
      config: {
        perTopicMax: 10,
        storagePerStudentBytes: 1073741824,
        videoMaxBytes: 262144000,
        sharingEnabled: true,
      },
    });
  });

  it('treats null like absent', () => {
    const r = parseSubmissionConfig({ SUBMISSIONS_PER_TOPIC_MAX: null });
    expect(r.ok && r.config.perTopicMax).toBe(10);
  });

  it('returns the given values when valid', () => {
    expect(
      parseSubmissionConfig({
        SUBMISSIONS_PER_TOPIC_MAX: '3',
        SUBMISSIONS_STORAGE_PER_STUDENT_BYTES: '5000',
        SUBMISSIONS_VIDEO_MAX_BYTES: ' 4000 ',
        SUBMISSIONS_SHARING_ENABLED: 'false',
      }),
    ).toEqual({
      ok: true,
      config: { perTopicMax: 3, storagePerStudentBytes: 5000, videoMaxBytes: 4000, sharingEnabled: false },
    });
  });

  it('accepts number- and boolean-typed values (wrangler JSON vars)', () => {
    const r = parseSubmissionConfig({
      SUBMISSIONS_PER_TOPIC_MAX: 7,
      SUBMISSIONS_SHARING_ENABLED: true,
    });
    expect(r).toMatchObject({ ok: true, config: { perTopicMax: 7, sharingEnabled: true } });
  });

  it('accepts a video limit equal to the storage limit', () => {
    const r = parseSubmissionConfig({
      SUBMISSIONS_STORAGE_PER_STUDENT_BYTES: '1000',
      SUBMISSIONS_VIDEO_MAX_BYTES: '1000',
    });
    expect(r.ok).toBe(true);
  });

  for (const variable of NUMERIC) {
    for (const bad of ['abc', '0', '-1', '1.5', '1e3', '', '  ', '+5', '99999999999999999999']) {
      it(`rejects ${variable}=${JSON.stringify(bad)} naming the var`, () => {
        const r = parseSubmissionConfig({ [variable]: bad });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.variable).toBe(variable);
      });
    }
  }

  for (const bad of ['yes', 'maybe', '1', '0', 'TRUE', 'False', '']) {
    it(`rejects SUBMISSIONS_SHARING_ENABLED=${JSON.stringify(bad)} naming the var`, () => {
      const r = parseSubmissionConfig({ SUBMISSIONS_SHARING_ENABLED: bad });
      expect(r).toMatchObject({ ok: false, variable: 'SUBMISSIONS_SHARING_ENABLED' });
    });
  }

  it('rejects a video limit above the storage limit, naming SUBMISSIONS_VIDEO_MAX_BYTES', () => {
    const r = parseSubmissionConfig({
      SUBMISSIONS_STORAGE_PER_STUDENT_BYTES: '1000',
      SUBMISSIONS_VIDEO_MAX_BYTES: '1001',
    });
    expect(r).toMatchObject({ ok: false, variable: 'SUBMISSIONS_VIDEO_MAX_BYTES' });
  });

  it('rejects a storage limit set below the default video limit', () => {
    const r = parseSubmissionConfig({ SUBMISSIONS_STORAGE_PER_STUDENT_BYTES: '1000' });
    expect(r).toMatchObject({ ok: false, variable: 'SUBMISSIONS_VIDEO_MAX_BYTES' });
    if (!r.ok) expect(r.reason).toContain('SUBMISSIONS_STORAGE_PER_STUDENT_BYTES');
  });

  it('never falls back to a default for a present-but-invalid var', () => {
    const r = parseSubmissionConfig({ SUBMISSIONS_PER_TOPIC_MAX: 'abc', SUBMISSIONS_SHARING_ENABLED: 'true' });
    expect(r.ok).toBe(false);
  });
});
