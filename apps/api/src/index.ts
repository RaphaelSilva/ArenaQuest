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
import type { D1Database } from '@cloudflare/workers-types';
import { JwtAuthAdapter } from '@api/adapters/auth';
import { D1UserRepository } from '@api/adapters/db/d1-user-repository';
import { D1RefreshTokenRepository } from '@api/adapters/db/d1-refresh-token-repository';
import { AuthService } from '@api/core/auth/auth-service';
import { buildAuthRouter } from '@api/routes/auth.router';
import { buildAdminUsersRouter } from '@api/routes/admin-users.router';
import { getHealth } from '@api/controllers/health.controller';
import { authGuard } from '@api/middleware/auth-guard';
import '@api/types/hono-env';

export interface AppEnv extends Env {
  /** HS256 signing secret for JWTs. Set with: wrangler secret put JWT_SECRET */
  JWT_SECRET: string;
  /** Cloudflare D1 database binding. Declared in wrangler.jsonc as "DB". */
  DB: D1Database;
  // STORAGE: R2Bucket;   // Phase 3
}

function buildApp(env: AppEnv): Hono {
  const auth = new JwtAuthAdapter({
    secret: env.JWT_SECRET,
    accessTokenExpiresInSeconds: 900, // 15 min
  });
  const users = new D1UserRepository(env.DB);
  const tokens = new D1RefreshTokenRepository(env.DB);
  const authService = new AuthService(auth, users, tokens);

  const app = new Hono();

  // Inject the auth adapter into every request context so middleware can use it.
  app.use('*', (c, next) => { c.set('auth', auth); return next(); });

  app.get('/health', (c) =>
    c.json(getHealth({ auth: 'jwt_pbkdf2', database: 'd1', storage: 'not_wired' })),
  );

  app.route('/auth', buildAuthRouter(authService));
  app.route('/admin/users', buildAdminUsersRouter(users, auth));

  // Sanity demo — development only, can be removed post-milestone.
  app.get('/protected/ping', authGuard, (c) =>
    c.json({ message: 'pong', email: c.get('user').email }),
  );

  return app;
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
