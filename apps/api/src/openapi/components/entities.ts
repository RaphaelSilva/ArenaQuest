import { z } from 'zod';
import { extendZodWithOpenApi } from '@hono/zod-openapi';

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

export const StorageReferenceSchema = z
  .union([MediaStorageReferenceSchema, EventFlyerStorageReferenceSchema])
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
