import { OpenAPIHono } from '@hono/zod-openapi';
import { buildLeaderboardRouter } from './leaderboard';
import { buildCatalogTopicsRouter } from './catalog.topics';
import { buildCatalogTasksRouter } from './catalog.tasks';
import type { AppContext } from '../../container';

export function buildPublicRouter(ctx: AppContext): OpenAPIHono {
  const publicRouter = new OpenAPIHono();

  // Mount leaderboard route
  publicRouter.route('/', buildLeaderboardRouter(ctx));

  // Mount catalog topics route
  publicRouter.route('/', buildCatalogTopicsRouter(ctx));

  // Mount catalog tasks route
  publicRouter.route('/', buildCatalogTasksRouter(ctx));

  return publicRouter;
}
