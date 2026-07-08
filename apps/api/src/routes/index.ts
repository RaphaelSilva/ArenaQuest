import { cors } from 'hono/cors';
import { OpenAPIHono } from '@hono/zod-openapi';
import { buildAuthRouter } from '@api/routes/auth';
import { buildAdminRouter } from '@api/routes/admin';
import { buildTopicsRouter } from '@api/routes/topics.router';
import { buildPublicRouter } from '@api/routes/public';
import { buildMeRouter } from '@api/routes/me';
import { buildCommentsRouter } from '@api/routes/comments.router';
import { buildHealthRouter } from '@api/routes/public/health';

import { authGuard } from '@api/middleware/auth-guard';
import { parseAllowedOrigins, buildOriginMatcher, hasAnyRule } from '@api/core/cors/origin-policy';
import type { AppContainer } from '@api/container';

/**
 * Main application router configuration.
 * Decouples route registration from the worker entry point.
 */
export class AppRouter {
  /**
   * Registers all application routes and common middleware.
   *
   * @param app - The main Hono application instance.
   * @param container - The fully-built AppContainer with all bounded-context groups.
   */
  static register(app: OpenAPIHono, container: AppContainer): void {
    const { identity, content, engagement, progress, gamification, infra, controllers } = container;

    // Build origin matcher from config — strict in prod, lenient in dev.
    const originRules = parseAllowedOrigins(infra.cors.allowedOrigins, { strict: infra.cors.strict });

    // Boot-time guardrail: when '*' is configured alongside credentials: true, the matcher
    // echoes the request origin instead of returning the literal '*'. Browsers reject
    // 'Access-Control-Allow-Origin: *' with credentialed requests (CORS spec §7.1.5).
    // This is correct and intentional behavior — the warning is for future maintainers.
    if (hasAnyRule(originRules)) {
      console.warn(
        '[CORS] ALLOWED_ORIGINS contains "*" with credentials: true. ' +
        'The origin matcher will echo the request origin rather than returning "*" ' +
        '(CORS spec §7.1.5 forbids ACAO: * with credentialed requests). ' +
        'This is intentional — restrict ALLOWED_ORIGINS in production environments.',
      );
    }

    const originMatcher = buildOriginMatcher(originRules);
    // Enable CORS for frontend interaction
    app.use(
      '*',
      cors({
        origin: originMatcher,
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
        allowHeaders: ['Content-Type', 'Authorization'],
        credentials: true,
      }),
    );

    // Inject the auth adapter into every request context so middleware can use it.
    app.use('*', (c, next) => {
      c.set('auth', infra.auth);
      return next();
    });

    // Mount unversioned public health route first
    app.route('/', buildHealthRouter());

    // Google OAuth redirect shim: Google Console keeps pointing to /auth/google/*
    // (no version prefix), but the real handlers live under /v1. These two routes
    // forward the browser to the versioned paths, preserving all query parameters.
    app.get('/auth/google', (c) => c.redirect('/v1/auth/google', 302));
    app.get('/auth/google/callback', (c) => {
      const { search } = new URL(c.req.url);
      return c.redirect(`/v1/auth/google/callback${search}`, 302);
    });

    // Consolidate versioned business routes under /v1 sub-app
    const v1 = new OpenAPIHono();
    v1.route('/', buildPublicRouter(container));
    v1.route('/', buildCommentsRouter({ engagement, progress, gamification }));
    v1.route('/auth', buildAuthRouter({ identity, infra, controllers, gamification }));
    v1.route('/admin', buildAdminRouter(container));
    v1.route('/me', buildMeRouter(container));
    v1.route('/topics', buildTopicsRouter({ content, progress, gamification }));

    app.route('/v1', v1);

    // Sanity demo — development only, can be removed post-milestone.
    app.get('/protected/ping', authGuard, (c) =>
      c.json({ message: 'pong', email: c.get('user').email }),
    );
  }
}
