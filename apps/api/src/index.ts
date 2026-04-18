/**
 * ArenaQuest — Cloudflare Worker entry point
 *
 * Adapter wiring pattern:
 *   - Ports (interfaces) live in @arenaquest/shared — imported here as types only.
 *   - Concrete adapters live in ./adapters — instantiated once per request
 *     using secrets/bindings from the Worker `env` object.
 *   - Route handlers receive adapters via parameter injection, never via
 *     module-level singletons (Workers have no shared memory between requests).
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { IAuthAdapter, IUserRepository } from '@arenaquest/shared/ports';
import { JwtAuthAdapter } from './adapters/auth';
import { D1UserRepository } from './adapters/db/d1-user-repository';

export interface AppEnv extends Env {
  /** HS256 signing secret for JWTs. Set with: wrangler secret put JWT_SECRET */
  JWT_SECRET: string;
  /** Cloudflare D1 database binding. Declared in wrangler.jsonc as "DB". */
  DB: D1Database;
  // STORAGE: R2Bucket;   // Phase 3
}

type Adapters = {
  auth: IAuthAdapter;
  db: { users: IUserRepository };
};

/** Build the adapter instances for a single request. */
function buildAdapters(env: AppEnv): Adapters {
  return {
    auth: new JwtAuthAdapter({
      secret: env.JWT_SECRET,
      accessTokenExpiresInSeconds: 900,  // 15 min
    }),
    db: {
      users: new D1UserRepository(env.DB),
    },
  };
}

export default {
  async fetch(request: Request, env: AppEnv, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const _adapters = buildAdapters(env);

    if (url.pathname === '/health') {
      return Response.json({
        status: 'ok',
        version: '0.1.0',
        timestamp: new Date().toISOString(),
        adapters: {
          auth: 'jwt_pbkdf2',
          database: 'not_wired',  // Phase 2
          storage: 'not_wired',   // Phase 2
        },
      });
    }

    return Response.json(
      { error: 'Not Found', path: url.pathname },
      { status: 404 },
    );
  },
} satisfies ExportedHandler<AppEnv>;