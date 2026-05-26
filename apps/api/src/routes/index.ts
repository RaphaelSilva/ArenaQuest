import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildAuthRouter } from './auth.router';
import { buildAdminUsersRouter } from './admin-users.router';
import { buildAdminTopicsRouter } from './admin-topics.router';
import { buildAdminMediaRouter } from './admin-media.router';
import { buildAdminTasksRouter } from './admin-tasks.router';
import { buildAdminMissionsRouter } from './admin-missions.router';
import { buildTasksRouter } from './tasks.router';
import { buildTopicsRouter } from './topics.router';
import {
  buildProgressTaskRouter,
  buildProgressTopicRouter,
  buildMeProgressRouter,
} from './progress.router';
import { buildAdminEnrollmentRouter } from './admin-enrollment.router';
import { buildAccountRouter } from './account.router';
import { buildOAuthRouter } from './oauth.router';
import { buildAdminBadgesRouter } from './admin-badges.router';
import { buildMeGamificationRouter } from './me-gamification.router';
import { buildLeaderboardRouter } from './leaderboard.router';
import { buildCommentsRouter } from './comments.router';

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
  static register(app: Hono, container: AppContainer): void {
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



    // Feature routes
    app.route('/', buildCommentsRouter({ engagement, progress, gamification }));
    app.route('/auth', buildAuthRouter({ identity, infra, controllers, gamification }));
    app.route('/admin/users', buildAdminUsersRouter({ identity, infra }));
    app.route('/admin/topics', buildAdminTopicsRouter({ content }));
    app.route('/admin/topics', buildAdminMediaRouter({ content }));
    app.route('/admin/tasks', buildAdminTasksRouter({ engagement, content }));
    app.route('/tasks', buildTasksRouter({ engagement, content, progress }));
    app.route('/tasks', buildProgressTaskRouter({ progress, engagement, content, gamification }));
    app.route('/topics', buildTopicsRouter({ content, progress, gamification }));
    app.route('/topics', buildProgressTopicRouter({ progress, engagement, content, gamification }));
    app.route('/me', buildMeProgressRouter({ progress, engagement, content }));
    app.route('/me', buildMeGamificationRouter({ gamification }));
    app.route('/leaderboard', buildLeaderboardRouter({ gamification, identity }));
    app.route('/admin', buildAdminEnrollmentRouter({ progress, identity, content }));
    app.route('/account', buildAccountRouter({ controllers }));
    app.route('/auth', buildOAuthRouter({ controllers, infra }));
    app.route('/admin/badges', buildAdminBadgesRouter({ gamification }));
    app.route('/admin/missions', buildAdminMissionsRouter({ gamification }));

    // Sanity demo — development only, can be removed post-milestone.
    app.get('/protected/ping', authGuard, (c) =>
      c.json({ message: 'pong', email: c.get('user').email }),
    );
  }
}
