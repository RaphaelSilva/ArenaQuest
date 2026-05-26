import { OpenAPIHono } from '@hono/zod-openapi';
import { buildLeaderboardRouter } from '@api/routes/public/leaderboard';
import { buildCatalogTopicsRouter } from '@api/routes/public/catalog.topics';
import { buildCatalogTasksRouter } from '@api/routes/public/catalog.tasks';
import type { AppContainer } from '@api/container';

export function buildPublicRouter(ctx: AppContainer): OpenAPIHono {
  const publicRouter = new OpenAPIHono();

  // Mount leaderboard route
  publicRouter.route('/', buildLeaderboardRouter(ctx));

  // Mount catalog topics route
  publicRouter.route('/', buildCatalogTopicsRouter(ctx));

  // Mount catalog tasks route
  publicRouter.route('/', buildCatalogTasksRouter(ctx));

  return publicRouter;
}
