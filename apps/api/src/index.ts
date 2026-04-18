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
import { AppRouter } from '@api/routes';
import '@api/types/hono-env';

export interface AppEnv extends Env {
  /** HS256 signing secret for JWTs. Set with: wrangler secret put JWT_SECRET */
  JWT_SECRET: string;
  /** Cloudflare D1 database binding. Declared in wrangler.jsonc as "DB". */
  DB: D1Database;
  /** Allowed origin for CORS (e.g. http://localhost:3000). */
  ALLOWED_ORIGIN?: string;
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

  AppRouter.register(app, { auth, users, authService, allowedOrigin: env.ALLOWED_ORIGIN });

  return app;
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
