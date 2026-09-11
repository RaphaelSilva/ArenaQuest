import { OpenAPIHono } from '@hono/zod-openapi';
import { authGuard } from '@api/middleware/auth-guard';
import { buildMeAccountRouter } from '@api/routes/me/account';
import { buildMeProgressRouter } from '@api/routes/me/progress';
import { buildMeGamificationRouter } from '@api/routes/me/gamification';
import { buildMeCommentsRouter } from '@api/routes/me/comments';
import { buildMeBillingRouter } from '@api/routes/me/billing';
import type {
  BillingContext,
  IdentityContext,
  InfraContext,
  ControllersContext,
  GamificationContext,
  ProgressContext,
  EngagementContext,
  ContentContext,
} from '@api/container';

export function buildMeRouter(slice: {
  identity: IdentityContext;
  infra: InfraContext;
  controllers: ControllersContext;
  gamification: GamificationContext;
  progress: ProgressContext;
  engagement: EngagementContext;
  content: ContentContext;
  billing: BillingContext;
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

  // 5. The caller's own billing statement. It rides the sub-app `authGuard`
  //    above and adds no guard of its own — billing reports, it never gates.
  meRouter.route('/', buildMeBillingRouter({ billing: slice.billing }));

  return meRouter;
}
