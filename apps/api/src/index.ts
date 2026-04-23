/**
 * ArenaQuest — Cloudflare Worker entry point
 *
 * Adapter wiring pattern:
 *   - Ports (interfaces) live in @arenaquest/shared — imported here as types only.
 *   - Concrete adapters live in ./adapters — instantiated once per request
 *     using secrets/bindings from the Worker `env` object.
 *   - Route handlers receive already-constructed services via closure, never via
 *     module-level singletons (Workers have no shared memory between requests).
 */

import { Hono } from 'hono';

import { JwtAuthAdapter } from '@api/adapters/auth';
import { D1UserRepository } from '@api/adapters/db/d1-user-repository';
import { D1RefreshTokenRepository } from '@api/adapters/db/d1-refresh-token-repository';
import { D1TopicNodeRepository } from '@api/adapters/db/d1-topic-node-repository';
import { D1TagRepository } from '@api/adapters/db/d1-tag-repository';
import { KvRateLimiter } from '@api/adapters/rate-limit/kv-rate-limiter';
import { AuthService } from '@api/core/auth/auth-service';
import { AppRouter } from '@api/routes';
import { parseCookieSameSite } from '@api/routes/auth.router';
import '@api/types/hono-env';

export type AppEnv = Env;

function buildApp(env: AppEnv): Hono {
  const auth = new JwtAuthAdapter({
    secret: env.JWT_SECRET,
    accessTokenExpiresInSeconds: 900, // 15 min
  });
  const users = new D1UserRepository(env.DB);
  const tokens = new D1RefreshTokenRepository(env.DB);
  const topics = new D1TopicNodeRepository(env.DB);
  const tags = new D1TagRepository(env.DB);
  const authService = new AuthService(auth, users, tokens);
  const loginLimiter = new KvRateLimiter(env.RATE_LIMIT_KV);

  const app = new Hono();

  AppRouter.register(app, {
    auth,
    users,
    tokens,
    topics,
    tags,
    authService,
    loginLimiter,
    cookieSameSite: parseCookieSameSite(env.COOKIE_SAMESITE),
    allowedOrigins: env.ALLOWED_ORIGINS,
  });

  return app;
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
