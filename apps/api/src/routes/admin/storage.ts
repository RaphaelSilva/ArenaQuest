import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import {
  AdminStorageController,
  AUDIT_MAX_LIMIT,
  AUDIT_MISSING_MAX_LIMIT,
  BROWSE_DEFAULT_LIMIT,
} from '@api/controllers/admin-storage.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import {
  StorageAuditMissingResponseSchema,
  StorageAuditResponseSchema,
  StorageBrowseResponseSchema,
  StorageObjectDetailSchema,
} from '@api/openapi/components/entities';
import type { AppContainer } from '@api/container';

/**
 * `/v1/admin/storage` — the admin storage browser and orphan audit (RFC 0018).
 *
 * HTTP only: parse, guard, shape. Classification lives in
 * `AdminStorageController`. Read-only — Task 06 adds the only write.
 */

const common = { tags: ['admin:storage'], security: [{ bearerAuth: [] }] };

const json = <S extends z.ZodTypeAny>(description: string, schema: S) => ({
  description,
  content: { 'application/json': { schema } },
});

const ERROR_RESPONSES = {
  400: { description: 'Validation failed or invalid cursor' },
  401: { description: 'Missing or invalid token' },
  403: { description: 'Forbidden — admin only' },
};

const Cursor = z.string().min(1).max(2048).optional().openapi({ description: 'Opaque `nextCursor` from the previous page.' });

const limitParam = (max: number, fallback: number) =>
  z.coerce.number().int().min(1).max(max).default(fallback).openapi({ example: fallback });

const Prefix = z
  .string()
  .max(1024)
  .default('')
  .refine((v) => v === '' || v.endsWith('/'), { message: "prefix must be '' or end with '/'" })
  .openapi({ description: "Folder to list: '' for the bucket root, otherwise ending with '/'.", example: 'topics/' });

export const browseStorageRoute = createRoute({
  ...common,
  method: 'get',
  path: '/browse',
  summary: 'Browse one storage folder',
  description: 'Delimited sub-folders (labelled with their topic / event) and the classified objects directly under `prefix`.',
  request: {
    query: z.object({
      prefix: Prefix,
      cursor: Cursor,
      limit: limitParam(AUDIT_MAX_LIMIT, BROWSE_DEFAULT_LIMIT),
    }),
  },
  responses: { 200: json('One folder page', StorageBrowseResponseSchema), ...ERROR_RESPONSES },
});

export const getStorageObjectRoute = createRoute({
  ...common,
  method: 'get',
  path: '/object',
  summary: 'Inspect one stored object',
  description: 'Head, references, classification and a presigned download URL valid for 5 minutes.',
  request: {
    query: z.object({
      key: z.string().min(1).max(1024).openapi({ example: 'topics/3f2c…/9a1b…-lesson.pdf' }),
    }),
  },
  responses: {
    200: json('Object detail', StorageObjectDetailSchema),
    ...ERROR_RESPONSES,
    404: { description: 'No object under that key' },
  },
});

export const auditStorageRoute = createRoute({
  ...common,
  method: 'get',
  path: '/audit',
  summary: 'Audit one page of the bucket',
  description: 'Walks up to `limit` keys flat and returns only the non-`linked` ones. Stateless: follow `nextCursor`.',
  request: {
    query: z.object({
      cursor: Cursor,
      limit: limitParam(AUDIT_MAX_LIMIT, AUDIT_MAX_LIMIT),
    }),
  },
  responses: { 200: json('Audit page', StorageAuditResponseSchema), ...ERROR_RESPONSES },
});

export const auditMissingStorageRoute = createRoute({
  ...common,
  method: 'get',
  path: '/audit/missing',
  summary: 'Find references whose object is gone',
  description: 'Checks up to `limit` live references and returns those whose object does not exist.',
  request: {
    query: z.object({
      cursor: Cursor,
      limit: limitParam(AUDIT_MISSING_MAX_LIMIT, AUDIT_MISSING_MAX_LIMIT),
    }),
  },
  responses: { 200: json('Missing-object page', StorageAuditMissingResponseSchema), ...ERROR_RESPONSES },
});

export function buildAdminStorageRouter(container: AppContainer) {
  const controller = new AdminStorageController(
    container.content.storage,
    container.content.storageReferences,
  );

  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  // The bucket view crosses every topic and event, drafts and restricted events
  // included — ADMIN only, stricter than the `/v1/admin` umbrella, which also
  // admits CONTENT_CREATOR (RFC 0018, M25 Decision 5).
  router.use('*', requireRole(ROLES.ADMIN));

  router.openapi(browseStorageRoute, async (c) => {
    const result = await controller.browse(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(getStorageObjectRoute, async (c) => {
    const result = await controller.object(c.req.valid('query').key);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(auditStorageRoute, async (c) => {
    const result = await controller.audit(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(auditMissingStorageRoute, async (c) => {
    const result = await controller.auditMissing(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  return router;
}
