import { OpenAPIHono } from '@hono/zod-openapi';
import { buildLoginRouter } from '@api/routes/auth/login';
import { buildRegisterRouter } from '@api/routes/auth/register';
import { buildActivateRouter } from '@api/routes/auth/activate';
import { buildPasswordRouter } from '@api/routes/auth/password';
import { buildOAuthRouter } from '@api/routes/auth/oauth.google';
import type { IdentityContext, InfraContext, ControllersContext, GamificationContext } from '@api/container';

export function buildAuthRouter(slice: {
  identity: IdentityContext;
  infra: InfraContext;
  controllers: ControllersContext;
  gamification: GamificationContext;
}): OpenAPIHono {
  const { registerController, activateController, passwordController, googleOAuthController } = slice.controllers;
  const { rateLimiters, cookies } = slice.infra;
  const { register: registerLimiter, activate: activateLimiter, forgotPassword: forgotPasswordLimiter } = rateLimiters;
  const cookieSameSite = cookies.sameSite;

  const authRouter = new OpenAPIHono();

  // 1. Session and login router
  authRouter.route('/', buildLoginRouter(slice));

  // 2. Register router
  authRouter.route('/', buildRegisterRouter({ controller: registerController, limiter: registerLimiter }));

  // 3. Activate router
  authRouter.route('/', buildActivateRouter({ controller: activateController, limiter: activateLimiter }));

  // 4. Password reset router
  authRouter.route('/', buildPasswordRouter({ controller: passwordController, forgotPasswordLimiter }));

  // 5. Google OAuth router
  authRouter.route('/', buildOAuthRouter({ controller: googleOAuthController, cookieSameSite }));

  return authRouter;
}
