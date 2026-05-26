import { OpenAPIHono } from '@hono/zod-openapi';
import { buildLoginRouter } from './login';
import { buildRegisterRouter } from './register';
import { buildActivateRouter } from './activate';
import { buildPasswordRouter } from './password';
import { buildOAuthRouter } from './oauth.google';
import type { IdentityContext, InfraContext, ControllersContext, GamificationContext } from '../../container';

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
