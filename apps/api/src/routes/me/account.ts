import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { getCookie } from 'hono/cookie';
import type { AccountController } from '@api/controllers/account.controller';
import { respondWith } from '@api/routes/_shared/envelope';

const COOKIE_NAME = 'refresh_token';

export const changePasswordRoute = createRoute({
  method: 'post',
  path: '/change-password',
  summary: 'Change Password',
  description: 'Changes the password for the authenticated user.',
  tags: ['me'],
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            currentPassword: z.string().openapi({ example: 'OldPassword1' }),
            newPassword: z.string().openapi({ example: 'NewPass123' }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Password successfully changed',
    },
    400: {
      description: 'Bad Request / Validation Failed',
    },
    401: {
      description: 'Unauthorized / Invalid Current Password',
    },
  },
});

export function buildMeAccountRouter(deps: {
  controller: AccountController;
}) {
  const { controller } = deps;
  const router = new OpenAPIHono();

  router.openapi(changePasswordRoute, async (c) => {
    const userId = c.get('user').sub;
    const currentRefreshToken = getCookie(c, COOKIE_NAME);
    const body = c.req.valid('json');

    const result = await controller.changePassword(userId, currentRefreshToken, body);

    if (!result.ok) {
      return respondWith(c, result);
    }

    return c.body(null, 200);
  });

  return router;
}
