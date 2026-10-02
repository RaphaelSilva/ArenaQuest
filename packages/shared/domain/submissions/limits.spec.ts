import { describe, expect, it } from 'vitest';
import {
  SUBMISSION_DESCRIPTION_MAX,
  SUBMISSION_PENDING_SWEEP_HOURS,
  SUBMISSION_TITLE_MAX,
  SUBMISSION_TUNABLE_DEFAULTS,
  SUBMISSIONS_PER_TOPIC_MAX_DEFAULT,
  SUBMISSIONS_SHARING_ENABLED_DEFAULT,
  SUBMISSIONS_STORAGE_PER_STUDENT_BYTES_DEFAULT,
  SUBMISSIONS_VIDEO_MAX_BYTES_DEFAULT,
} from './limits';

describe('submission limits (RFC 0020 section 3)', () => {
  // Spelled as literals so a changed default fails here instead of shipping.
  it('keeps the text limits and the sweep threshold', () => {
    expect(SUBMISSION_TITLE_MAX).toBe(120);
    expect(SUBMISSION_DESCRIPTION_MAX).toBe(2000);
    expect(SUBMISSION_PENDING_SWEEP_HOURS).toBe(24);
  });

  it('keeps the four env defaults', () => {
    expect(SUBMISSIONS_PER_TOPIC_MAX_DEFAULT).toBe(10);
    expect(SUBMISSIONS_STORAGE_PER_STUDENT_BYTES_DEFAULT).toBe(1073741824);
    expect(SUBMISSIONS_VIDEO_MAX_BYTES_DEFAULT).toBe(262144000);
    expect(SUBMISSIONS_SHARING_ENABLED_DEFAULT).toBe(true);
  });

  it('groups the defaults in one frozen object', () => {
    expect(SUBMISSION_TUNABLE_DEFAULTS).toEqual({
      perTopicMax: 10,
      storagePerStudentBytes: 1073741824,
      videoMaxBytes: 262144000,
      sharingEnabled: true,
    });
    expect(Object.isFrozen(SUBMISSION_TUNABLE_DEFAULTS)).toBe(true);
  });

  it('never lets one video exceed the per-student storage', () => {
    expect(SUBMISSION_TUNABLE_DEFAULTS.videoMaxBytes).toBeLessThanOrEqual(
      SUBMISSION_TUNABLE_DEFAULTS.storagePerStudentBytes,
    );
  });
});
