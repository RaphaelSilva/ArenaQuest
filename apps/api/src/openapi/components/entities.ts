import { z } from 'zod';
import { extendZodWithOpenApi } from '@hono/zod-openapi';
import { SUBMISSION_MEDIA_TYPES } from '@arenaquest/shared/domain/media/limits';
import {
  SUBMISSION_DESCRIPTION_MAX,
  SUBMISSION_TITLE_MAX,
} from '@arenaquest/shared/domain/submissions/limits';
import {
  MISSION_STEPS_MAX,
  MissionEnrollmentMode,
  MissionMode,
  REQUIREMENT_KINDS,
  REQUIREMENT_TITLE_MAX,
  RequirementInput,
} from '@arenaquest/shared/domain/missions/requirements';

extendZodWithOpenApi(z);

// Re-export Config enums for convenience, or define them locally
export const TopicNodeStatusSchema = z.enum(['draft', 'published', 'archived']).openapi({
  description: 'The status of the topic node.',
  example: 'published',
});

export const TaskStatusSchema = z.enum(['draft', 'published', 'archived']).openapi({
  description: 'The status of the task.',
  example: 'published',
});

export const MediaStatusSchema = z.enum(['pending', 'ready', 'deleted']).openapi({
  description: 'The status of the media.',
  example: 'ready',
});

export const TagSchema = z.object({
  id: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  name: z.string().openapi({ example: 'TypeScript' }),
  slug: z.string().openapi({ example: 'typescript' }),
}).openapi('Tag');

export const MediaSchema = z.object({
  id: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  topicNodeId: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  url: z.string().url().openapi({ example: 'https://example.com/media/123.jpg' }),
  type: z.string().openapi({ example: 'image/jpeg' }),
  storageKey: z.string().openapi({ example: 'media/123.jpg' }),
  sizeBytes: z.number().int().positive().openapi({ example: 102400 }),
  originalName: z.string().openapi({ example: 'my-image.jpg' }),
  uploadedById: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  status: MediaStatusSchema.openapi({ example: 'ready' }),
  createdAt: z.string().datetime().openapi({ example: '2023-01-01T12:00:00Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2023-01-01T13:00:00Z' }),
}).openapi('Media');

export const TopicNodeSchema = z.object({
  id: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  parentId: z.string().uuid().nullable().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  title: z.string().openapi({ example: 'Introduction to Programming' }),
  content: z.string().openapi({ example: 'This topic covers the basics of programming.' }),
  status: TopicNodeStatusSchema.openapi({ example: 'published' }),
  media: z.array(MediaSchema).openapi({ description: 'Associated media files.' }),
  tags: z.array(TagSchema).openapi({ description: 'Associated tags.' }),
  order: z.number().int().positive().openapi({ example: 1 }),
  estimatedMinutes: z.number().int().positive().openapi({ example: 60 }),
  prerequisiteIds: z.array(z.string().uuid()).openapi({
    example: ['a1b2c3d4-e5f6-7890-1234-567890abcdef'],
  }),
}).openapi('TopicNode');

export const TaskStageSchema = z.object({
  id: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  label: z.string().openapi({ example: 'Complete coding challenge' }),
  order: z.number().int().positive().openapi({ example: 1 }),
  createdAt: z.string().datetime().openapi({ example: '2023-01-01T12:00:00Z' }),
}).openapi('TaskStage');

export const TaskSchema = z.object({
  id: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  title: z.string().openapi({ example: 'Learn basic JavaScript' }),
  description: z.string().openapi({ example: 'Complete a series of JavaScript exercises.' }),
  status: TaskStatusSchema.openapi({ example: 'published' }),
  createdBy: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  createdAt: z.string().datetime().openapi({ example: '2023-01-01T12:00:00Z' }),
  updatedAt: z.string().datetime().openapi({ example: '2023-01-01T13:00:00Z' }),
  stages: z.array(TaskStageSchema).openapi({ description: 'Stages of the task.' }),
  linkedTopic: z.array(TopicNodeSchema.pick({ id: true, title: true })).openapi({
    description: 'Linked topics (simplified to id and title).',
  }), // Simplified for public view
}).openapi('Task');

export const LeaderboardEntrySchema = z.object({
  userId: z.string().uuid().openapi({
    example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef',
  }),
  name: z.string().openapi({ example: 'John Doe' }),
  xp: z.number().int().openapi({ example: 1250 }),
}).openapi('LeaderboardEntry');

export const LoginRequestSchema = z.object({
  email: z.string().email().openapi({ example: 'student@arenaquest.app' }),
  password: z.string().openapi({ example: 'password123' }),
}).openapi('LoginRequest');

export const LoginResponseSchema = z.object({
  accessToken: z.string().openapi({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' }),
  user: z.object({
    id: z.string().uuid(),
    name: z.string(),
    email: z.string().email(),
    roles: z.array(z.string()),
  }),
}).openapi('LoginResponse');

export const RegisterRequestSchema = z.object({
  name: z.string().trim().min(2).max(80).openapi({ example: 'John Doe' }),
  email: z.string().trim().toLowerCase().email().openapi({ example: 'student@arenaquest.app' }),
  password: z.string().min(8).regex(/\d/).openapi({ example: 'password123' }),
}).openapi('RegisterRequest');

export const ActivateRequestSchema = z.object({
  token: z.string().min(1).openapi({ example: 'some-activation-token' }),
}).openapi('ActivateRequest');

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().openapi({ example: 'student@arenaquest.app' }),
}).openapi('ForgotPasswordRequest');

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1).openapi({ example: 'some-reset-token' }),
  newPassword: z.string().min(8).regex(/\d/).openapi({ example: 'newpassword123' }),
}).openapi('ResetPasswordRequest');

export const CommentSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  topicNodeId: z.string().openapi({ example: 'cmt-topic-1' }),
  parentCommentId: z.string().uuid().nullable().openapi({ example: null }),
  userId: z.string().openapi({ example: 'cmt-student-a' }),
  userName: z.string().openapi({ example: 'Student A' }),
  body: z.string().nullable().openapi({ example: 'This topic was very helpful!' }),
  createdAt: z.string().datetime().openapi({ example: '2024-01-01T12:00:00Z' }),
  deletedAt: z.string().datetime().nullable().openapi({ example: null }),
}).openapi('Comment');

export const CommentWithMetaSchema = CommentSchema.extend({
  likeCount: z.number().int().openapi({ example: 3 }),
  likedByMe: z.boolean().openapi({ example: false }),
}).openapi('CommentWithMeta');

export const BADGE_RULE_KINDS = [
  'streak_days',
  'topic_completed',
  'videos_watched_in_period',
  'total_xp',
  'mission_completed',
] as const;

export const CreateBadgeBodySchema = z.object({
  slug: z.string().min(1).openapi({ example: 'perfect-streak' }),
  name: z.string().min(1).openapi({ example: 'Perfect Streak' }),
  iconEmoji: z.string().min(1).openapi({ example: '🔥' }),
  description: z.string().optional().openapi({ example: 'Complete a streak.' }),
  xpReward: z.number().int().min(0).optional().openapi({ example: 100 }),
  ruleKind: z.enum(BADGE_RULE_KINDS).openapi({ example: 'streak_days' }),
  ruleParams: z.string().optional().openapi({ example: '7' }),
}).openapi('CreateBadgeBody');

export const UpdateBadgeBodySchema = z.object({
  name: z.string().min(1).optional().openapi({ example: 'New Badge Name' }),
  iconEmoji: z.string().min(1).optional().openapi({ example: '🏆' }),
  description: z.string().optional().openapi({ example: 'New description' }),
  xpReward: z.number().int().min(0).optional().openapi({ example: 200 }),
  ruleKind: z.enum(BADGE_RULE_KINDS).optional().openapi({ example: 'total_xp' }),
  ruleParams: z.string().optional().openapi({ example: '1000' }),
  active: z.boolean().optional().openapi({ example: true }),
}).openapi('UpdateBadgeBody');



// ---------------------------------------------------------------------------
// Admin storage browser (RFC 0018 / M25)
// ---------------------------------------------------------------------------

export const StorageStatusSchema = z
  .enum(['linked', 'pending', 'displaced', 'deleted-row', 'orphan'])
  .openapi({ description: 'Server-side classification of a stored object.', example: 'linked' });

export const StorageOrphanHintSchema = z
  .enum(['owner-topic-gone', 'owner-event-gone', 'row-gone', 'unknown-shape'])
  .openapi({ description: 'Why an `orphan` has no owner, read from the key shape.', example: 'row-gone' });

export const MediaStorageReferenceSchema = z.object({
  kind: z.literal('media'),
  key: z.string(),
  mediaId: z.string(),
  status: MediaStatusSchema,
  originalName: z.string().openapi({ example: 'Lesson One.pdf' }),
  type: z.string().openapi({ example: 'application/pdf' }),
  sizeBytes: z.number().int(),
  uploaderId: z.string(),
  uploader: z.object({ id: z.string(), name: z.string() }).nullable(),
  topicId: z.string(),
  topic: z.object({ id: z.string(), title: z.string(), status: TopicNodeStatusSchema }).nullable(),
  createdAt: z.string().openapi({ example: '2026-09-29T12:00:00.000Z' }),
}).openapi('MediaStorageReference');

export const EventFlyerStorageReferenceSchema = z.object({
  kind: z.enum(['event-flyer', 'event-flyer-displaced']),
  key: z.string(),
  eventId: z.string(),
  title: z.string(),
  slug: z.string(),
  flyerStatus: z.enum(['none', 'pending', 'ready']),
  flyerName: z.string().nullable(),
}).openapi('EventFlyerStorageReference');

export const SubmissionStorageReferenceSchema = z.object({
  kind: z.literal('submission'),
  key: z.string().openapi({ example: 'submissions/student-a/9a1b…-kata.mp4' }),
  submissionId: z.string(),
  status: z.enum(['pending', 'ready', 'removed']).openapi({
    description: 'A `removed` tombstone has no key, so only `pending` / `ready` resolve in practice.',
    example: 'ready',
  }),
  title: z.string().openapi({ example: 'Kata, 2nd attempt' }),
  originalName: z.string().openapi({ example: 'IMG_0042.MOV' }),
  contentType: z.string().openapi({ example: 'video/quicktime' }),
  sizeBytes: z.number().int(),
  authorId: z.string(),
  author: z.object({ id: z.string(), name: z.string() }).nullable(),
  topicId: z.string(),
  topic: z.object({ id: z.string(), title: z.string(), status: TopicNodeStatusSchema }).nullable(),
  createdAt: z.string().openapi({ example: '2026-09-29T12:00:00.000Z' }),
}).openapi('SubmissionStorageReference');

export const StorageReferenceSchema = z
  .union([MediaStorageReferenceSchema, EventFlyerStorageReferenceSchema, SubmissionStorageReferenceSchema])
  .openapi('StorageReference');

export const ClassifiedObjectSchema = z.object({
  key: z.string().openapi({ example: 'topics/3f2c…/9a1b…-lesson.pdf' }),
  name: z.string().openapi({ description: 'Last path segment of the key.', example: '9a1b…-lesson.pdf' }),
  size: z.number().int(),
  uploadedAt: z.string().openapi({ example: '2026-09-29T12:00:00.000Z' }),
  contentType: z.string().nullable(),
  status: StorageStatusSchema,
  stale: z.boolean().openapi({ description: 'Only ever true for `pending`: older than the 24 h grace window.' }),
  hint: StorageOrphanHintSchema.nullable().openapi({ description: 'Set only when `status` is `orphan`.' }),
  references: z.array(StorageReferenceSchema),
}).openapi('ClassifiedObject');

export const StorageFolderSchema = z.object({
  prefix: z.string().openapi({ example: 'topics/3f2c…/' }),
  name: z.string().openapi({ description: 'Last segment of the prefix, without the delimiter.' }),
  owner: z
    .object({ kind: z.enum(['topic', 'event']), id: z.string(), title: z.string() })
    .nullable()
    .openapi({ description: 'The topic / event a `topics/<id>/` or `events/<id>/` folder belongs to, when it exists.' }),
  ownerGone: z.boolean().openapi({ description: 'True for an owner-shaped folder whose topic / event no longer exists.' }),
}).openapi('StorageFolder');

export const StorageBrowseResponseSchema = z.object({
  prefix: z.string(),
  folders: z.array(StorageFolderSchema),
  objects: z.array(ClassifiedObjectSchema),
  nextCursor: z.string().optional(),
}).openapi('StorageBrowseResponse');

export const StorageObjectDetailSchema = ClassifiedObjectSchema.extend({
  downloadUrl: z.string().openapi({ description: 'Presigned GET URL, valid for 5 minutes.' }),
  downloadUrlExpiresAt: z.string().openapi({ example: '2026-09-29T12:05:00.000Z' }),
}).openapi('StorageObjectDetail');

export const StorageDeleteResponseSchema = z.object({
  deleted: z.literal(true),
  key: z.string(),
  size: z.number().int(),
  status: z.enum(['orphan', 'deleted-row']).openapi({ description: 'Classification the object had when it was removed.' }),
}).openapi('StorageDeleteResponse');

export const StorageDeleteConflictSchema = z.object({
  error: z.literal('StorageObjectNotDeletable'),
  reason: z.enum(['not-deletable-status', 'within-grace-window']).openapi({
    description: '`not-deletable-status`: not `orphan` / `deleted-row`. `within-grace-window`: uploaded less than 24 h ago.',
  }),
  object: ClassifiedObjectSchema.openapi({ description: 'The classification read during this request.' }),
}).openapi('StorageDeleteConflict');

export const StorageAuditResponseSchema = z.object({
  objects: z.array(ClassifiedObjectSchema).openapi({ description: 'Only the non-`linked` objects of the page.' }),
  scanned: z.number().int().openapi({ description: 'Number of keys walked for this page.' }),
  nextCursor: z.string().optional(),
}).openapi('StorageAuditResponse');

export const StorageMissingObjectSchema = z.object({
  key: z.string(),
  status: z.literal('missing-object'),
  reference: StorageReferenceSchema,
}).openapi('StorageMissingObject');

export const StorageAuditMissingResponseSchema = z.object({
  items: z.array(StorageMissingObjectSchema),
  scanned: z.number().int().openapi({ description: 'Number of references checked for this page.' }),
  nextCursor: z.string().optional(),
}).openapi('StorageAuditMissingResponse');

// ---------------------------------------------------------------------------
// Student notes (RFC 0016)
// ---------------------------------------------------------------------------

export const NOTE_VISIBILITIES = ['private', 'shared'] as const;

export const NoteSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  topicNodeId: z.string().openapi({ example: 'topic-1' }),
  authorId: z.string().openapi({ example: 'student-a' }),
  authorName: z.string().openapi({ example: 'Student A' }),
  body: z.string().openapi({ description: 'Sanitised Markdown, 1..NOTE_BODY_MAX characters', example: 'The **key idea** is...' }),
  visibility: z.enum(NOTE_VISIBILITIES).openapi({ example: 'private' }),
  revision: z.number().int().min(1).openapi({ description: 'Concurrency token; send it back as `baseRevision`', example: 1 }),
  sharedAt: z.string().nullable().openapi({ description: 'Last time the note became shared; null if it never was', example: null }),
  moderated: z.boolean().openapi({ description: 'True while a staff force-unshare blocks re-sharing', example: false }),
  createdAt: z.string().openapi({ example: '2026-09-28 12:00:00' }),
  updatedAt: z.string().openapi({ example: '2026-09-28 12:00:00' }),
}).openapi('Note');

export const ClassNoteSchema = NoteSchema.extend({
  isMine: z.boolean().openapi({ description: 'True when the caller wrote this note', example: false }),
}).openapi('ClassNote');

export const AuthoredNoteSchema = NoteSchema.extend({
  topicTitle: z.string().openapi({ example: 'Intro to Algebra' }),
  topicAccessible: z.boolean().openapi({
    description: 'False when the caller can no longer read the topic; the note is then read-only (delete allowed)',
    example: true,
  }),
}).openapi('AuthoredNote');

export const StaffNoteSchema = NoteSchema.extend({
  moderatedAt: z.string().nullable().openapi({ description: 'When staff force-unshared the note; null when not moderated', example: null }),
  moderatedBy: z.string().nullable().openapi({ description: 'The staff member who force-unshared the note; null when not moderated', example: null }),
}).openapi('StaffNote');

export const StaffAuthoredNoteSchema = StaffNoteSchema.extend({
  topicTitle: z.string().openapi({ example: 'Intro to Algebra' }),
}).openapi('StaffAuthoredNote');

const nextCursorField = z.string().nullable().openapi({
  description: 'Opaque cursor of the next page; null on the last page',
  example: null,
});

export const ClassNotePageSchema = z.object({
  data: z.array(ClassNoteSchema),
  nextCursor: nextCursorField,
}).openapi('ClassNotePage');

export const AuthoredNotePageSchema = z.object({
  data: z.array(AuthoredNoteSchema),
  nextCursor: nextCursorField,
}).openapi('AuthoredNotePage');

export const StaffAuthoredNotePageSchema = z.object({
  data: z.array(StaffAuthoredNoteSchema),
  nextCursor: nextCursorField,
}).openapi('StaffAuthoredNotePage');

export const SaveNoteBodySchema = z.object({
  body: z.string().openapi({ description: 'Markdown; sanitised and trimmed, then must be 1..NOTE_BODY_MAX characters', example: 'My note' }),
  visibility: z.enum(NOTE_VISIBILITIES).optional().openapi({ description: 'Omitted: keep the current visibility (private on create)', example: 'private' }),
  baseRevision: z.number().int().min(0).openapi({ description: 'The revision last received; 0 when no note exists yet', example: 0 }),
}).openapi('SaveNoteBody');

export const NoteConflictBodySchema = z.object({
  error: z.enum(['NOTE_STALE', 'NOTE_MODERATED']).openapi({ example: 'NOTE_STALE' }),
  current: NoteSchema.nullable().optional().openapi({
    description: 'NOTE_STALE only: the stored note (null when it no longer exists)',
  }),
}).openapi('NoteConflictBody');

// ---------------------------------------------------------------------------
// Student submissions (RFC 0020)
// ---------------------------------------------------------------------------

export const SubmissionSchema = z.object({
  id: z.string().uuid().openapi({ example: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
  topicNodeId: z.string().openapi({ example: 'topic-1' }),
  authorId: z.string().openapi({ example: 'student-a' }),
  authorName: z.string().openapi({ example: 'Student A' }),
  title: z.string().openapi({ description: '1..SUBMISSION_TITLE_MAX characters', example: 'Kata, 2nd attempt' }),
  description: z.string().openapi({ description: "Sanitised Markdown, ≤ SUBMISSION_DESCRIPTION_MAX; '' when empty or removed", example: '' }),
  originalName: z.string().openapi({ example: 'IMG_0042.MOV' }),
  contentType: z.enum(SUBMISSION_MEDIA_TYPES).openapi({ example: 'video/quicktime' }),
  sizeBytes: z.number().int().positive().openapi({ description: 'Declared at presign, verified at finalize', example: 52_428_800 }),
  status: z.enum(['pending', 'ready', 'removed']).openapi({ example: 'ready' }),
  visibility: z.enum(NOTE_VISIBILITIES).openapi({ example: 'private' }),
  sharedAt: z.string().nullable().openapi({ description: 'Null while private', example: null }),
  moderated: z.boolean().openapi({ description: 'True while a staff force-unshare blocks re-sharing', example: false }),
  removedAt: z.string().nullable().openapi({ description: 'Null unless status is `removed`', example: null }),
  createdAt: z.string().openapi({ example: '2026-09-29 12:00:00' }),
  updatedAt: z.string().openapi({ example: '2026-09-29 12:00:00' }),
}).openapi('Submission');

export const PresignSubmissionBodySchema = z.object({
  fileName: z.string().min(1).max(255).openapi({ example: 'IMG_0042.MOV' }),
  contentType: z.enum(SUBMISSION_MEDIA_TYPES).openapi({ example: 'video/quicktime' }),
  sizeBytes: z.number().int().positive().openapi({ description: 'Exact byte length of the file; the presigned PUT signs it', example: 52_428_800 }),
  title: z.string().trim().min(1).max(SUBMISSION_TITLE_MAX).openapi({ example: 'Kata, 2nd attempt' }),
  description: z.string().max(SUBMISSION_DESCRIPTION_MAX * 4).optional().openapi({
    description: 'Markdown; sanitised, then must be ≤ SUBMISSION_DESCRIPTION_MAX characters',
    example: 'Left side',
  }),
  visibility: z.enum(NOTE_VISIBILITIES).optional().openapi({ description: 'Defaults to private', example: 'private' }),
}).openapi('PresignSubmissionBody');

export const PresignSubmissionResponseSchema = z.object({
  submission: SubmissionSchema,
  uploadUrl: z.string().url().openapi({ description: 'Presigned PUT; send the declared Content-Type and length' }),
  expiresAt: z.string().openapi({ description: 'ISO-8601 instant the upload URL expires', example: '2026-09-29T13:00:00.000Z' }),
}).openapi('PresignSubmissionResponse');

export const EditSubmissionBodySchema = z.object({
  title: z.string().trim().min(1).max(SUBMISSION_TITLE_MAX).optional().openapi({ example: 'Kata, final' }),
  description: z.string().max(SUBMISSION_DESCRIPTION_MAX * 4).optional().openapi({
    description: 'Markdown; sanitised, then must be ≤ SUBMISSION_DESCRIPTION_MAX characters',
  }),
  visibility: z.enum(NOTE_VISIBILITIES).optional().openapi({ example: 'shared' }),
}).openapi('EditSubmissionBody');

export const SubmissionQuotaErrorSchema = z.object({
  error: z.literal('SUBMISSION_QUOTA'),
  reason: z.enum(['count', 'storage']).openapi({ description: '`count`: per-topic limit; `storage`: per-student bytes' }),
  used: z.number().int().openapi({ example: 10 }),
  limit: z.number().int().openapi({ example: 10 }),
}).openapi('SubmissionQuotaError');

export const SubmissionSummarySchema = z.object({
  limits: z.object({
    perTopicMax: z.number().int().openapi({ example: 10 }),
    storagePerStudentBytes: z.number().int().openapi({ example: 1_073_741_824 }),
    videoMaxBytes: z.number().int().openapi({ example: 262_144_000 }),
  }),
  sharingEnabled: z.boolean().openapi({ example: true }),
  usage: z.object({
    topicCount: z.number().int().openapi({ description: "Caller's pending + ready submissions on this topic", example: 2 }),
    bytes: z.number().int().openapi({ description: "Caller's pending + ready bytes across all topics", example: 104_857_600 }),
  }),
  classCount: z.number().int().openapi({ description: 'Shared ready submissions on the topic; 0 when sharing is disabled', example: 8 }),
  totalCount: z.number().int().optional().openapi({ description: 'Staff only: every ready + removed submission on the topic', example: 12 }),
}).openapi('SubmissionSummary');

const submissionUrlField = z.string().url().nullable().openapi({
  description: 'Signed GET URL (TTL 1 h) on a ready submission; null while pending or once removed',
});

export const SubmissionViewSchema = SubmissionSchema.extend({
  isMine: z.boolean().openapi({ description: "True on the caller's own submission", example: false }),
  url: submissionUrlField,
}).openapi('SubmissionView');

export const SubmissionPageSchema = z.object({
  data: z.array(SubmissionViewSchema),
  nextCursor: nextCursorField,
}).openapi('SubmissionPage');

const submissionProvenanceFields = {
  moderatedAt: z.string().nullable().openapi({ description: 'When staff force-unshared the submission; null when not moderated', example: null }),
  moderatedBy: z.string().nullable().openapi({ description: 'The staff member who force-unshared it; null when not moderated', example: null }),
  removedBy: z.string().nullable().openapi({ description: 'The admin who removed it; null unless removed (or the account is gone)', example: null }),
  removedByName: z.string().nullable().openapi({ description: 'Display name of `removedBy`; null when unknown', example: null }),
};

export const StaffSubmissionViewSchema = SubmissionViewSchema.extend(submissionProvenanceFields).openapi('StaffSubmissionView');

export const StaffSubmissionPageSchema = z.object({
  data: z.array(StaffSubmissionViewSchema),
  nextCursor: nextCursorField,
}).openapi('StaffSubmissionPage');

export const StaffAuthoredSubmissionSchema = StaffSubmissionViewSchema.extend({
  topicTitle: z.string().openapi({ example: 'Kihon' }),
}).openapi('StaffAuthoredSubmission');

export const StaffAuthoredSubmissionPageSchema = z.object({
  data: z.array(StaffAuthoredSubmissionSchema),
  nextCursor: nextCursorField,
}).openapi('StaffAuthoredSubmissionPage');

export const AuthoredSubmissionSchema = SubmissionSchema.extend({
  url: submissionUrlField,
  topicTitle: z.string().openapi({ example: 'Kihon' }),
  topicAccessible: z.boolean().openapi({
    description: 'False when the topic is no longer readable: read-only except delete and move',
    example: true,
  }),
}).openapi('AuthoredSubmission');

export const AuthoredSubmissionPageSchema = z.object({
  data: z.array(AuthoredSubmissionSchema),
  nextCursor: nextCursorField,
}).openapi('AuthoredSubmissionPage');

export const MoveSubmissionsBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(10).openapi({
    description: '1..10 ids of the caller\'s own ready submissions, moved in this order',
    example: ['a1b2c3d4-e5f6-7890-1234-567890abcdef'],
  }),
  targetTopicId: z.string().min(1).openapi({ example: 'topic-2' }),
}).openapi('MoveSubmissionsBody');

export const MoveSubmissionsResultSchema = z.object({
  moved: z.array(SubmissionSchema).openapi({ description: 'Moved submissions, now private; moderation kept' }),
  refused: z.array(z.object({
    id: z.string(),
    reason: z.enum(['quota', 'not_found', 'not_ready', 'same_topic']).openapi({
      description: '`quota`: the target is full; `not_found`: missing or not the caller\'s; `not_ready`: pending or removed; `same_topic`: already there',
    }),
  })),
}).openapi('MoveSubmissionsResult');

// ---------------------------------------------------------------------------
// Missions (RFC 0022 §6)
// ---------------------------------------------------------------------------

const MISSION_TITLE_MAX = 120;
const MISSION_DESCRIPTION_MAX = 2_000;

const uuidExample = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';

export const MissionModeSchema = MissionMode.openapi({
  description: '`parallel`: every step open at once; `sequential`: step N opens when N-1 completes',
  example: 'sequential',
});

export const MissionEnrollmentModeSchema = MissionEnrollmentMode.openapi({
  description: 'Who takes part: implicit (`auto`), by Join (`open`) or by audience (`assigned`)',
  example: 'auto',
});

export const MissionSchema = z.object({
  id: z.string().uuid().openapi({ example: uuidExample }),
  title: z.string().openapi({ example: 'Kihon month' }),
  description: z.string().openapi({ example: 'Three demonstrations, then the seminar.' }),
  startAt: z.string().openapi({ example: '2026-10-01T12:00:00.000Z' }),
  endAt: z.string().openapi({ example: '2026-10-31T23:59:59.000Z' }),
  predicateKind: z.string().openapi({
    deprecated: true,
    description: "Legacy M7 predicate; `requirements` for every mission defined by requirements",
    example: 'requirements',
  }),
  predicateParams: z.string().openapi({
    deprecated: true,
    description: "Legacy M7 predicate params; `{}` for every mission defined by requirements",
    example: '{}',
  }),
  xpReward: z.number().int().openapi({ example: 500 }),
  badgeId: z.string().nullable().openapi({ example: null }),
  active: z.boolean().openapi({ example: true }),
  mode: MissionModeSchema,
  enrollmentMode: MissionEnrollmentModeSchema,
  createdAt: z.string().openapi({ example: '2026-10-01T12:00:00.000Z' }),
  updatedAt: z.string().openapi({ example: '2026-10-01T13:00:00.000Z' }),
}).openapi('Mission');

export const MissionListItemSchema = MissionSchema.extend({
  requirementCount: z.number().int().openapi({ description: 'Steps of the mission (0 for a legacy mission)', example: 2 }),
  enrolledCount: z.number().int().openapi({ description: 'Active enrollments', example: 12 }),
  completedCount: z.number().int().openapi({ description: 'Enrolled users whose mission progress is completed', example: 3 }),
}).openapi('MissionListItem');

export const MissionRequirementSchema = z.object({
  id: z.string().uuid().openapi({ example: uuidExample }),
  missionId: z.string().uuid().openapi({ example: uuidExample }),
  position: z.number().int().openapi({ description: '1-based order inside the mission', example: 1 }),
  kind: z.enum(REQUIREMENT_KINDS).openapi({ example: 'submissions_on_topic' }),
  title: z.string().openapi({ example: 'Three demonstrations' }),
  topicId: z.string().nullable().openapi({ description: 'Target of the three topic kinds; null otherwise', example: uuidExample }),
  eventId: z.string().nullable().openapi({ description: 'Target of `event_participation`; null otherwise', example: null }),
  params: z.record(z.unknown()).openapi({
    description: "The kind's params, defaults applied",
    example: { minCount: 3, requireDescription: false, visibility: 'any', countModerated: false },
  }),
  xpReward: z.number().int().openapi({ example: 50 }),
  createdAt: z.string().openapi({ example: '2026-10-01 12:00:00' }),
  updatedAt: z.string().openapi({ example: '2026-10-01 12:00:00' }),
}).openapi('MissionRequirement');

export const MissionAudienceSchema = z.object({
  groupIds: z.array(z.string().uuid()).openapi({ example: [uuidExample] }),
  userIds: z.array(z.string().uuid()).openapi({ example: [] }),
}).openapi('MissionAudience');

export const MissionDetailSchema = z.object({
  mission: MissionSchema,
  requirements: z.array(MissionRequirementSchema).openapi({ description: 'Ordered by position' }),
  audience: MissionAudienceSchema,
}).openapi('MissionDetail');

export const MissionRequirementInputSchema = RequirementInput.openapi('MissionRequirementInput', {
  description: 'One step, discriminated on `kind`; every object is strict (unknown keys are refused)',
});

const requirementListField = z.array(MissionRequirementInputSchema).min(1).max(MISSION_STEPS_MAX).openapi({
  description: `1..${MISSION_STEPS_MAX} steps; positions follow the array order`,
});

export const MissionCreateBodySchema = z.object({
  title: z.string().trim().min(1).max(MISSION_TITLE_MAX).openapi({ example: 'Kihon month' }),
  description: z.string().trim().min(1).max(MISSION_DESCRIPTION_MAX).openapi({ example: 'Three demonstrations, then the seminar.' }),
  startAt: z.string().datetime().openapi({ example: '2026-10-01T12:00:00.000Z' }),
  endAt: z.string().datetime().openapi({ description: 'Must be after `startAt`', example: '2026-10-31T23:59:59.000Z' }),
  mode: MissionModeSchema.default('parallel'),
  enrollmentMode: MissionEnrollmentModeSchema.default('auto'),
  xpReward: z.number().int().min(0).default(0).openapi({ example: 500 }),
  badgeId: z.string().uuid().nullable().default(null).openapi({ example: null }),
  requirements: requirementListField,
  audience: MissionAudienceSchema.optional().openapi({ description: "Only with `enrollmentMode = 'assigned'`" }),
}).strict().openapi('MissionCreateBody');

export const MissionPatchBodySchema = z.object({
  title: z.string().trim().min(1).max(MISSION_TITLE_MAX).optional(),
  description: z.string().trim().min(1).max(MISSION_DESCRIPTION_MAX).optional(),
  startAt: z.string().datetime().optional().openapi({ description: 'Locked once the mission started' }),
  endAt: z.string().datetime().optional().openapi({ description: 'Once started, may only be extended' }),
  mode: MissionModeSchema.optional().openapi({ description: 'Locked once the mission started' }),
  enrollmentMode: MissionEnrollmentModeSchema.optional().openapi({ description: 'Locked once the mission started' }),
  xpReward: z.number().int().min(0).optional().openapi({ description: 'Locked once the mission started' }),
  badgeId: z.string().uuid().nullable().optional().openapi({ description: 'Locked once the mission started' }),
  active: z.boolean().optional(),
}).strict().openapi('MissionPatchBody');

export const ReplaceMissionRequirementsBodySchema = z.object({
  requirements: requirementListField,
}).strict().openapi('ReplaceMissionRequirementsBody');

export const MissionRequirementTitleBodySchema = z.object({
  title: z.string().trim().min(1).max(REQUIREMENT_TITLE_MAX).openapi({ example: 'Three demonstrations' }),
}).strict().openapi('MissionRequirementTitleBody');

export const MissionRequirementErrorSchema = z.object({
  error: z.enum(['ValidationError', 'INVALID_REQUIREMENT_TARGET', 'EVENT_NOT_CHARGEABLE', 'REQUIREMENT_SHARING_DISABLED']),
  index: z.number().int().optional().openapi({ description: 'Index of the offending item in `requirements`' }),
  reason: z.string().optional().openapi({
    description: 'TOPIC_NOT_FOUND · TOPIC_NOT_PUBLISHED · TOPIC_ARCHIVED · TOPIC_HAS_NO_VIDEO · EVENT_NOT_FOUND · EVENT_NOT_PUBLISHED · EVENT_NOT_CHARGEABLE · REQUIREMENT_SHARING_DISABLED, or a schema reason (UNKNOWN_KIND, UNRECOGNIZED_KEYS, TOO_SMALL, …)',
    example: 'TOPIC_ARCHIVED',
  }),
  field: z.string().optional().openapi({ description: 'Schema errors: the path inside the item', example: 'params.minCount' }),
}).passthrough().openapi('MissionRequirementError');

export const MissionStartedErrorSchema = z.object({
  error: z.literal('MISSION_STARTED'),
  fields: z.array(z.string()).openapi({ example: ['mode'] }),
}).openapi('MissionStartedError');

export const MissionParticipantStepSchema = z.object({
  requirementId: z.string().uuid(),
  currentCount: z.number().int(),
  targetCount: z.number().int(),
  checkedAt: z.string().nullable(),
  completedAt: z.string().nullable().openapi({ description: 'Evidence instant of the target-th item' }),
  completedBy: z.enum(['hook', 'reconcile']).nullable(),
}).openapi('MissionParticipantStep');

export const MissionParticipantSchema = z.object({
  userId: z.string().openapi({ example: uuidExample }),
  name: z.string().nullable().openapi({ example: 'Student A' }),
  email: z.string().nullable().openapi({ example: 'student@example.com' }),
  source: z.enum(['auto', 'self', 'admin']),
  joinedAt: z.string().openapi({ example: '2026-10-01 12:00:00' }),
  countsFrom: z.string().openapi({ example: '2026-10-01T12:00:00.000Z' }),
  leftAt: z.string().nullable().openapi({ example: null }),
  progress: z.object({
    currentValue: z.number().int().openapi({ description: 'Completed steps' }),
    targetValue: z.number().int().openapi({ description: 'Step count' }),
    completed: z.boolean(),
    completedAt: z.string().nullable(),
  }).nullable(),
  steps: z.array(MissionParticipantStepSchema).openapi({ description: 'Evaluated steps, in position order' }),
}).openapi('MissionParticipant');

export const MissionParticipantPageSchema = z.object({
  data: z.array(MissionParticipantSchema),
  nextCursor: nextCursorField,
}).openapi('MissionParticipantPage');

export const MissionReconcileReportSchema = z.object({
  missions: z.number().int().openapi({ description: 'Missions reconciled (1 for this route)', example: 1 }),
  enrollmentsCreated: z.number().int().openapi({ description: 'Implicit enrollments materialised', example: 3 }),
  evidenceBackfilled: z.number().int().openapi({ description: "Evidence rows captured with `source = 'backfill'`", example: 2 }),
  enrollmentsEvaluated: z.number().int().openapi({ description: 'Active enrollments evaluated', example: 12 }),
  stepsClosed: z.number().int().openapi({ description: "Steps completed by this run (`completedBy = 'reconcile'`)", example: 4 }),
  missionsClosed: z.number().int().openapi({ description: 'Mission completions granted by this run', example: 1 }),
  failed: z.number().int().openapi({ description: 'Missions whose reconciliation failed (0 or 1 here)', example: 0 }),
}).openapi('MissionReconcileReport');

// ---------------------------------------------------------------------------
// Student missions (RFC 0022 §5, §6, §8)
// ---------------------------------------------------------------------------

export const MissionProgressSchema = z.object({
  userId: z.string(),
  missionId: z.string(),
  currentValue: z.number().int().openapi({ description: 'Completed steps (or the legacy single counter)', example: 1 }),
  targetValue: z.number().int().openapi({ description: 'Step count (or the legacy target)', example: 3 }),
  completed: z.boolean(),
  completedAt: z.string().nullable().openapi({ example: null }),
  updatedAt: z.string().openapi({ example: '2026-10-02T12:00:00.000Z' }),
}).openapi('MissionProgress');

const MissionTopicTargetSchema = z.object({
  type: z.literal('topic'),
  topicId: z.string().nullable().openapi({ description: "null when the topic is outside the caller's access", example: uuidExample }),
  title: z.string().nullable().openapi({ example: 'Kihon' }),
  accessible: z.boolean(),
}).openapi('MissionTopicTarget');

const MissionEventTargetSchema = z.object({
  type: z.literal('event'),
  slug: z.string().nullable().openapi({ description: 'null when the event is not visible to the caller', example: 'seminar-2026' }),
  title: z.string().nullable().openapi({ example: 'Seminar' }),
  startsAt: z.string().nullable().openapi({ example: '2026-10-20T13:00:00.000Z' }),
}).openapi('MissionEventTarget');

export const MissionStepViewSchema = z.object({
  id: z.string().openapi({ description: 'Requirement id', example: uuidExample }),
  position: z.number().int().openapi({ example: 1 }),
  kind: z.enum(REQUIREMENT_KINDS).openapi({ example: 'submissions_on_topic' }),
  title: z.string().openapi({ example: 'Three demonstrations' }),
  xpReward: z.number().int().openapi({ example: 50 }),
  target: z.union([MissionTopicTargetSchema, MissionEventTargetSchema]).nullable().openapi({
    description: 'A topic or event the caller cannot open is redacted (no id, title or slug); null for `manual_check`',
  }),
  instructions: z.string().nullable().openapi({ description: '`manual_check` only', example: null }),
  current: z.number().int().openapi({ example: 1 }),
  required: z.number().int().openapi({ example: 3 }),
  state: z.enum(['locked', 'open', 'completed']),
  completedAt: z.string().nullable().openapi({ description: 'Evidence instant of the target-th item', example: null }),
}).openapi('MissionStepView');

export const MissionEnrollmentViewSchema = z.object({
  source: z.enum(['auto', 'self', 'admin']),
  joinedAt: z.string().nullable().openapi({ description: 'null for an implicit enrollment', example: null }),
  implicit: z.boolean().openapi({ description: 'Granted by the policy, no row written yet (reads never write)' }),
}).openapi('MissionEnrollmentView');

export const MissionLockedSchema = z.object({
  reason: z.literal('assigned'),
  groups: z.array(z.string()).openapi({ description: "Names of the mission's audience groups", example: ['Black belts'] }),
}).openapi('MissionLocked');

export const DashboardMissionEntrySchema = z.object({
  mission: MissionSchema.openapi({ description: 'For a locked teaser only `id` and `title` are meaningful' }),
  progress: MissionProgressSchema.nullable(),
  enrollment: MissionEnrollmentViewSchema.nullable(),
  joinable: z.boolean().openapi({ description: '`open` mission, inside its window, caller not enrolled' }),
  locked: MissionLockedSchema.nullable().openapi({ description: 'Teaser of an `assigned` mission the caller is not in' }),
  steps: z.array(MissionStepViewSchema).openapi({ description: 'Ordered steps; `[]` for a legacy mission or a teaser' }),
}).openapi('DashboardMissionEntry');

export const MissionCheckResultSchema = z.object({
  step: MissionStepViewSchema,
  mission: DashboardMissionEntrySchema,
}).openapi('MissionCheckResult');
