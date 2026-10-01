import type { SubmissionSummary, SubmissionView } from '@web/lib/submissions-api';

export const MB = 1024 * 1024;

export function summary(overrides: Partial<SubmissionSummary> = {}): SubmissionSummary {
  return {
    limits: { perTopicMax: 10, storagePerStudentBytes: 1024 * MB, videoMaxBytes: 250 * MB },
    sharingEnabled: true,
    usage: { topicCount: 3, bytes: 420 * MB },
    classCount: 8,
    ...overrides,
  };
}

export function view(overrides: Partial<SubmissionView> = {}): SubmissionView {
  return {
    id: 's1',
    topicNodeId: 't1',
    authorId: 'me',
    authorName: 'Me',
    title: 'Kata',
    description: '',
    originalName: 'kata.mp4',
    contentType: 'video/mp4',
    sizeBytes: 5 * MB,
    status: 'ready',
    visibility: 'private',
    sharedAt: null,
    moderated: false,
    removedAt: null,
    createdAt: '2026-09-29 12:00:00',
    updatedAt: '2026-09-29 12:00:00',
    isMine: true,
    url: 'https://r2.example/kata.mp4',
    ...overrides,
  };
}

/** A picked file whose reported size is `size`, without allocating it. */
export function fakeFile(name: string, type: string, size: number): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}
