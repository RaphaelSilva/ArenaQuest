import type { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildAuthRouter } from './auth.router';
import type { CookieSameSite } from './auth.router';
import type { RegisterController } from '@api/controllers/register.controller';
import type { ActivateController } from '@api/controllers/activate.controller';
import type { PasswordController } from '@api/controllers/password.controller';
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
import type { AccountController } from '@api/controllers/account.controller';
import type { GoogleOAuthController } from '@api/controllers/google-oauth.controller';

import { authGuard } from '@api/middleware/auth-guard';
import { parseAllowedOrigins, buildOriginMatcher, hasAnyRule } from '@api/core/cors/origin-policy';
import type {
  IAuthAdapter,
  IRateLimiter,
  IRefreshTokenRepository,
  IUserRepository,
  ITopicNodeRepository,
  ITagRepository,
  IMediaRepository,
  IStorageAdapter,
  ITaskRepository,
  ITaskStageRepository,
  ITaskLinkingRepository,
  IProgressRepository,
  IEnrollmentRepository,
  IQuestRepository,
  IBadgeRepository,
  IGamificationRepository,
  ICommentRepository,
} from '@arenaquest/shared/ports';
import type { IMissionRepository } from '@arenaquest/shared/ports';
import type { AuthService } from '@api/core/auth/auth-service';
import type { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';
import type { StreakEngine } from '@arenaquest/shared/domain/gamification/streak-engine';
import type { QuestEvaluator } from '@arenaquest/shared/domain/gamification/quest-evaluator';
import type { BadgeEngine } from '@arenaquest/shared/domain/gamification/badge-engine';

/**
 * Main application router configuration.
 * Decouples route registration from the worker entry point.
 */
export class AppRouter {
  /**
   * Registers all application routes and common middleware.
   *
   * @param app - The main Hono application instance.
   * @param deps - Object containing the required services and adapters.
   */
  static register(
    app: Hono,
    deps: {
      auth: IAuthAdapter;
      users: IUserRepository;
      tokens: IRefreshTokenRepository;
      topics: ITopicNodeRepository;
      tags: ITagRepository;
      media: IMediaRepository;
      storage: IStorageAdapter;
      taskRepo: ITaskRepository;
      taskStages: ITaskStageRepository;
      taskLinks: ITaskLinkingRepository;
      progressRepo: IProgressRepository;
      enrollmentRepo: IEnrollmentRepository;
      questRepo: IQuestRepository;
      badgeRepo: IBadgeRepository;
      gamificationRepo: IGamificationRepository;
      missionRepo: IMissionRepository;
      commentRepo: ICommentRepository;
      xpEngine?: XpEngine;
      streakEngine?: StreakEngine;
      questEvaluator?: QuestEvaluator;
      badgeEngine?: BadgeEngine;
      authService: AuthService;
      loginLimiter: IRateLimiter;
      registerController: RegisterController;
      registerLimiter: IRateLimiter;
      activateController: ActivateController;
      activateLimiter: IRateLimiter;
      passwordController: PasswordController;
      forgotPasswordLimiter: IRateLimiter;
      accountController: AccountController;
      googleOAuthController: GoogleOAuthController;
      mailer: import('@arenaquest/shared/ports').IMailer;
      cookieSameSite: CookieSameSite;
      allowedOrigins?: string;
      /**
       * When true, `parseAllowedOrigins` throws at construction time if
       * `allowedOrigins` is missing or invalid. Set to `false` for local dev
       * so a missing var doesn't prevent `wrangler dev` from booting.
       */
      strictCors: boolean;
    },
  ): void {
    const { auth, users, tokens, topics, tags, media, storage, taskRepo, taskStages, taskLinks, progressRepo, enrollmentRepo, questRepo: _questRepo, badgeRepo, gamificationRepo, missionRepo, commentRepo, xpEngine, streakEngine, questEvaluator, badgeEngine, authService, loginLimiter, registerController, registerLimiter, activateController, activateLimiter, passwordController, forgotPasswordLimiter, accountController, googleOAuthController, mailer, cookieSameSite, allowedOrigins, strictCors } = deps;
    // Build origin matcher from config — strict in prod, lenient in dev.
    const originRules = parseAllowedOrigins(allowedOrigins, { strict: strictCors });

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
      c.set('auth', auth);
      return next();
    });



    // Feature routes
    app.route('/', buildCommentsRouter(commentRepo, enrollmentRepo, xpEngine));
    app.route('/auth', buildAuthRouter({ authService, loginLimiter, cookieSameSite, registerController, registerLimiter, activateController, activateLimiter, passwordController, forgotPasswordLimiter, streakEngine, questEvaluator, badgeEngine }));
    app.route('/admin/users', buildAdminUsersRouter(users, auth, tokens, mailer));
    app.route('/admin/topics', buildAdminTopicsRouter(topics, tags));
    app.route('/admin/topics', buildAdminMediaRouter(topics, media, storage));
    app.route('/admin/tasks', buildAdminTasksRouter(taskRepo, taskStages, taskLinks, topics));
    app.route('/tasks', buildTasksRouter(taskRepo, taskStages, taskLinks, topics, enrollmentRepo));
    app.route('/tasks', buildProgressTaskRouter(progressRepo, enrollmentRepo, taskRepo, taskStages, taskLinks, topics, xpEngine, streakEngine, questEvaluator, badgeEngine));
    app.route('/topics', buildTopicsRouter(topics, media, storage, enrollmentRepo, xpEngine, streakEngine, questEvaluator, badgeEngine));
    app.route('/topics', buildProgressTopicRouter(progressRepo, enrollmentRepo, taskRepo, taskStages, taskLinks, topics, xpEngine, streakEngine, questEvaluator, badgeEngine));
    app.route('/me', buildMeProgressRouter(progressRepo, enrollmentRepo, taskRepo, taskStages, taskLinks, topics));
    app.route('/me', buildMeGamificationRouter(gamificationRepo, _questRepo, badgeRepo, missionRepo));
    app.route('/leaderboard', buildLeaderboardRouter(gamificationRepo, users));
    app.route('/admin', buildAdminEnrollmentRouter(enrollmentRepo, users, topics));
    app.route('/account', buildAccountRouter(accountController));
    app.route('/auth', buildOAuthRouter(googleOAuthController, cookieSameSite));
    app.route('/admin/badges', buildAdminBadgesRouter(badgeRepo));
    app.route('/admin/missions', buildAdminMissionsRouter(missionRepo));

    // Sanity demo — development only, can be removed post-milestone.
    app.get('/protected/ping', authGuard, (c) =>
      c.json({ message: 'pong', email: c.get('user').email }),
    );
  }
}
