import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MEDIA_TYPES,
  SUBMISSION_MEDIA_TYPES,
  SUBMISSION_VIDEO_TYPES,
  isSubmissionMediaType,
  isSubmissionVideoType,
  mediaSizeLimitFor,
} from './limits';

describe('submission media types (RFC 0020 section 3)', () => {
  it('is the course table plus video/quicktime, in order', () => {
    expect([...SUBMISSION_MEDIA_TYPES]).toEqual([...ALLOWED_MEDIA_TYPES, 'video/quicktime']);
  });

  it('leaves backoffice media without video/quicktime', () => {
    expect((ALLOWED_MEDIA_TYPES as readonly string[]).includes('video/quicktime')).toBe(false);
    expect(mediaSizeLimitFor('video/quicktime')).toBeNull();
  });

  it('declares exactly the two video types, both accepted for submissions', () => {
    expect([...SUBMISSION_VIDEO_TYPES]).toEqual(['video/mp4', 'video/quicktime']);
    for (const type of SUBMISSION_VIDEO_TYPES) {
      expect(isSubmissionMediaType(type)).toBe(true);
    }
  });

  it('narrows a submission type and rejects anything else', () => {
    for (const type of SUBMISSION_MEDIA_TYPES) {
      expect(isSubmissionMediaType(type)).toBe(true);
    }
    expect(isSubmissionMediaType('image/gif')).toBe(false);
    expect(isSubmissionMediaType('application/zip')).toBe(false);
    expect(isSubmissionMediaType('')).toBe(false);
  });

  it('treats only mp4 and quicktime as videos', () => {
    expect(isSubmissionVideoType('video/mp4')).toBe(true);
    expect(isSubmissionVideoType('video/quicktime')).toBe(true);
    expect(isSubmissionVideoType('image/jpeg')).toBe(false);
    expect(isSubmissionVideoType('application/pdf')).toBe(false);
  });
});
