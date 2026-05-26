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
  name: z.string().openapi({ example: 'John Doe' }),
  email: z.string().email().openapi({ example: 'student@arenaquest.app' }),
  password: z.string().openapi({ example: 'password123' }),
}).openapi('RegisterRequest');

export const ActivateRequestSchema = z.object({
  token: z.string().openapi({ example: 'some-activation-token' }),
}).openapi('ActivateRequest');

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email().openapi({ example: 'student@arenaquest.app' }),
}).openapi('ForgotPasswordRequest');

export const ResetPasswordRequestSchema = z.object({
  token: z.string().openapi({ example: 'some-reset-token' }),
  newPassword: z.string().openapi({ example: 'newpassword123' }),
}).openapi('ResetPasswordRequest');

