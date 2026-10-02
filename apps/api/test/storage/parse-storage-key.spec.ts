import { describe, it, expect } from 'vitest';
import { parseStorageKey, ORPHAN_GRACE_MS } from '@arenaquest/shared/domain/storage';

const TOPIC_ID = '0b6f2d0e-5c1a-4d7e-9a3b-1f2e3d4c5b6a';
const MEDIA_ID = '9f8e7d6c-5b4a-4321-8fed-cba987654321';
const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const FLYER_UUID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('parseStorageKey', () => {
  it('decodes a topic media key into topic id, media id and file name', () => {
    expect(parseStorageKey(`topics/${TOPIC_ID}/${MEDIA_ID}-intro-to-kata.mp4`)).toEqual({
      kind: 'topic-media',
      topicId: TOPIC_ID,
      mediaId: MEDIA_ID,
      fileName: 'intro-to-kata.mp4',
    });
  });

  it('decodes an event flyer key into the event id and file name', () => {
    expect(parseStorageKey(`events/${EVENT_ID}/flyer-${FLYER_UUID}-summer-camp.png`)).toEqual({
      kind: 'event-flyer',
      eventId: EVENT_ID,
      fileName: 'summer-camp.png',
    });
  });

  it('decodes a submission key into author id, submission id and file name', () => {
    expect(parseStorageKey(`submissions/student-a/${MEDIA_ID}-kata-2nd-attempt.mp4`)).toEqual({
      kind: 'submission',
      authorId: 'student-a',
      submissionId: MEDIA_ID,
      fileName: 'kata-2nd-attempt.mp4',
    });
  });

  it('returns unknown for a submission key that does not match the builder shape', () => {
    expect(parseStorageKey('submissions/student-a/not-a-uuid-file.mp4')).toEqual({ kind: 'unknown' });
    expect(parseStorageKey(`submissions/student-a/extra/${MEDIA_ID}-a.mp4`)).toEqual({ kind: 'unknown' });
    expect(parseStorageKey(`submissions/${MEDIA_ID}-a.mp4`)).toEqual({ kind: 'unknown' });
  });

  it('returns unknown for a nested path under a topic folder', () => {
    expect(parseStorageKey(`topics/${TOPIC_ID}/extra/${MEDIA_ID}-a.pdf`)).toEqual({ kind: 'unknown' });
  });

  it('returns unknown when the file-name segment contains slashes', () => {
    expect(parseStorageKey(`topics/${TOPIC_ID}/${MEDIA_ID}-dir/sub/file.pdf`)).toEqual({ kind: 'unknown' });
    expect(parseStorageKey(`events/${EVENT_ID}/flyer-${FLYER_UUID}-a/b.png`)).toEqual({ kind: 'unknown' });
  });

  it('returns unknown for keys outside the known shapes', () => {
    expect(parseStorageKey('random/file.txt')).toEqual({ kind: 'unknown' });
    expect(parseStorageKey(`topics/${TOPIC_ID}/not-a-uuid-file.pdf`)).toEqual({ kind: 'unknown' });
    expect(parseStorageKey(`events/${EVENT_ID}/poster-${FLYER_UUID}-x.png`)).toEqual({ kind: 'unknown' });
    expect(parseStorageKey(`topics/${TOPIC_ID}/`)).toEqual({ kind: 'unknown' });
    expect(parseStorageKey('')).toEqual({ kind: 'unknown' });
  });
});

describe('ORPHAN_GRACE_MS', () => {
  it('is a fixed 24 hours', () => {
    expect(ORPHAN_GRACE_MS).toBe(86_400_000);
  });
});
