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

import type { IAuthAdapter } from '@arenaquest/shared/ports';
import { JwtAuthAdapter } from './adapters/auth';

/**
 * Worker environment bindings.
 * Add Cloudflare bindings (KV, D1, R2, etc.) here as Phase 2 adapters land.
 * Secrets are set via: `wrangler secret put <NAME>`
 */
export interface AppEnv extends Env {
  /** HS256 signing secret for JWTs. Set with: wrangler secret put JWT_SECRET */
  JWT_SECRET: string;

  // Phase 2 — uncomment as implementations are added:
  // DB: D1Database;         // or Hyperdrive for Postgres
  // STORAGE: R2Bucket;
}

/** Build the adapter instances for a single request. */
function buildAdapters(env: AppEnv): { auth: IAuthAdapter } {
  return {
    auth: new JwtAuthAdapter({
      secret: env.JWT_SECRET,
      accessTokenExpiresInSeconds: 900,  // 15 min
    }),
  };
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const adapters = buildAdapters(env);

    if (url.pathname === '/health') {
      const dbAlive = false; // will call adapters.db.ping() in Phase 2
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