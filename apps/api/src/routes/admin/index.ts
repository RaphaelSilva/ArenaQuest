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
import { buildAdminLevelsRouter } from './levels';
import { buildAdminProgressionRouter } from './progression';
import { buildAdminEnrollmentsRouter } from './enrollments';
import { buildAdminGroupsRouter } from './groups';
import { buildAdminBillingRouter } from './billing';
import { buildAdminEventsRouter } from './events';
import { buildAdminNotesRouter } from './notes';
import type { AppContainer } from '@api/container';

export function buildAdminRouter(container: AppContainer) {
  const app = new OpenAPIHono();

  // Apply root level authentication and role checks once for the entire sub-app
  app.use('*', authGuard, requireRole(ROLES.ADMIN, ROLES.CONTENT_CREATOR));

  // Staff notes (RFC 0016). MUST stay registered before '/users': the users
  // router applies `requireRole(ROLES.ADMIN)` to '/users/*', which would also
  // catch 'GET /users/{userId}/notes' and 403 a content creator. Hono runs
  // handlers in registration order and this one responds, so the later
  // '/users/*' middleware never runs for that path. Guarded by a spec asserting
  // a content creator gets 200 there (test/routes/admin-notes.router.spec.ts).
  app.route('/', buildAdminNotesRouter(container));
  app.route('/users', buildAdminUsersRouter(container));
  app.route('/topics', buildAdminTopicsRouter(container));
  app.route('/tasks', buildAdminTasksRouter(container));
  app.route('/badges', buildAdminBadgesRouter(container));
  app.route('/missions', buildAdminMissionsRouter(container));
  app.route('/quests', buildAdminQuestsRouter(container));
  app.route('/levels', buildAdminLevelsRouter(container));
  app.route('/players', buildAdminProgressionRouter(container));
  app.route('/groups', buildAdminGroupsRouter(container));
  // Carries its own requireRole(ROLES.ADMIN) — the umbrella above admits CONTENT_CREATOR.
  app.route('/billing', buildAdminBillingRouter(container));
  // Carries its own requireRole(ROLES.ADMIN) on the publish transition only —
  // a content creator writes drafts here, but does not put them on the internet.
  app.route('/events', buildAdminEventsRouter(container));
  // Mounted at '/' to match legacy paths '/admin/users/:userId/enrollments' and '/admin/groups/:groupId/enrollments' exactly
  app.route('/', buildAdminEnrollmentsRouter(container));

  return app;
}
export type AdminRouter = ReturnType<typeof buildAdminRouter>;
