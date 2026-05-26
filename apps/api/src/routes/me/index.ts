import { OpenAPIHono } from '@hono/zod-openapi';
import { authGuard } from '../../middleware/auth-guard';
import { buildMeAccountRouter } from './account';
import { buildMeProgressRouter } from './progress';
import { buildMeGamificationRouter } from './gamification';
import { buildMeCommentsRouter } from './comments';
import type {
  IdentityContext,
  InfraContext,
  ControllersContext,
  GamificationContext,
  ProgressContext,
  EngagementContext,
  ContentContext,
} from '../../container';

export function buildMeRouter(slice: {
  identity: IdentityContext;
  infra: InfraContext;
  controllers: ControllersContext;
  gamification: GamificationContext;
  progress: ProgressContext;
  engagement: EngagementContext;
  content: ContentContext;
}): OpenAPIHono {
  const { accountController } = slice.controllers;

  const meRouter = new OpenAPIHono();

  // Enforce authGuard on all /me routes at sub-app level
  meRouter.use('*', authGuard);

  // 1. Account profile router
  meRouter.route('/', buildMeAccountRouter({ controller: accountController }));

  // 2. Progress router
  meRouter.route('/', buildMeProgressRouter(slice));

  // 3. Gamification router
  meRouter.route('/', buildMeGamificationRouter(slice));

  // 4. Comments authored writes router
  meRouter.route('/', buildMeCommentsRouter({ engagement: slice.engagement }));

  return meRouter;
}
