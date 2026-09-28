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
