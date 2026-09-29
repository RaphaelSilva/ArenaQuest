import { describe, expect, it } from 'vitest';
import { sanitizeFileName as adminMediaSanitize } from '@api/controllers/admin-media.controller';
import { sanitizeFileName } from '@arenaquest/shared/utils/sanitize-file-name';
import { ALLOWED_MEDIA_TYPES, SUBMISSION_MEDIA_TYPES } from '@arenaquest/shared/domain/media/limits';
import { SUBMISSION_TUNABLE_DEFAULTS } from '@arenaquest/shared/domain/submissions/limits';

// M23 Task 01 — the shared submission contracts as the API sees them.
describe('submission contracts (RFC 0020)', () => {
  it('admin-media re-exports the shared sanitizeFileName, output unchanged', () => {
    expect(adminMediaSanitize).toBe(sanitizeFileName);
    expect(adminMediaSanitize('My Document.pdf')).toBe('my-document.pdf');
  });

  it('derives the submission types from the course table plus video/quicktime', () => {
    expect([...SUBMISSION_MEDIA_TYPES]).toEqual([...ALLOWED_MEDIA_TYPES, 'video/quicktime']);
  });

  it('exposes the four env defaults', () => {
    expect(SUBMISSION_TUNABLE_DEFAULTS).toEqual({
      perTopicMax: 10,
      storagePerStudentBytes: 1073741824,
      videoMaxBytes: 262144000,
      sharingEnabled: true,
    });
  });
});
