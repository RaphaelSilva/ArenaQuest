import { OpenAPIHono } from '@hono/zod-openapi';
import { authGuard } from '@api/middleware/auth-guard';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { buildAdminUsersRouter } from './users';
import { buildAdminTopicsRouter } from './topics';
import { buildAdminTasksRouter } from './tasks';
import { buildAdminBadgesRouter } from './badges';
import { buildAdminMissionsRouter } from './missions';
import { buildAdminQuestsRouter } from './quests';
import { buildAdminEnrollmentsRouter } from './enrollments';
import { buildAdminGroupsRouter } from './groups';
import type { AppContainer } from '@api/container';

export function buildAdminRouter(container: AppContainer) {
  const app = new OpenAPIHono();

  // Apply root level authentication and role checks once for the entire sub-app
  app.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  app.route('/users', buildAdminUsersRouter(container));
  app.route('/topics', buildAdminTopicsRouter(container));
  app.route('/tasks', buildAdminTasksRouter(container));
  app.route('/badges', buildAdminBadgesRouter(container));
  app.route('/missions', buildAdminMissionsRouter(container));
  app.route('/quests', buildAdminQuestsRouter(container));
  app.route('/groups', buildAdminGroupsRouter(container));
  // Mounted at '/' to match legacy paths '/admin/users/:userId/enrollments' and '/admin/groups/:groupId/enrollments' exactly
  app.route('/', buildAdminEnrollmentsRouter(container));

  return app;
}
export type AdminRouter = ReturnType<typeof buildAdminRouter>;
