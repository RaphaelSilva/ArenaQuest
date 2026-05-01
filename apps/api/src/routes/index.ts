import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildAuthRouter } from './auth.router';
import type { CookieSameSite } from './auth.router';
import type { RegisterController } from '@api/controllers/register.controller';
import type { ActivateController } from '@api/controllers/activate.controller';
import { buildAdminUsersRouter } from './admin-users.router';
import { buildAdminTopicsRouter } from './admin-topics.router';
import { buildAdminMediaRouter } from './admin-media.router';
import { buildTopicsRouter } from './topics.router';
import { getHealth } from '@api/controllers/health.controller';
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
} from '@arenaquest/shared/ports';
import type { AuthService } from '@api/core/auth/auth-service';

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
      authService: AuthService;
      loginLimiter: IRateLimiter;
      registerController: RegisterController;
      registerLimiter: IRateLimiter;
      activateController: ActivateController;
      activateLimiter: IRateLimiter;
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
    const { auth, users, tokens, topics, tags, media, storage, authService, loginLimiter, registerController, registerLimiter, activateController, activateLimiter, cookieSameSite, allowedOrigins, strictCors } = deps;
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

    // Health check endpoint
    app.get('/health', (c) =>
      c.json(getHealth({ auth: 'jwt_pbkdf2', database: 'd1', storage: 'not_wired' })),
    );

    // Feature routes
    app.route('/auth', buildAuthRouter({ authService, loginLimiter, cookieSameSite, registerController, registerLimiter, activateController, activateLimiter }));
    app.route('/admin/users', buildAdminUsersRouter(users, auth, tokens));
    app.route('/admin/topics', buildAdminTopicsRouter(topics, tags));
    app.route('/admin/topics', buildAdminMediaRouter(topics, media, storage));
    app.route('/topics', buildTopicsRouter(topics, media, storage));

    // Sanity demo — development only, can be removed post-milestone.
    app.get('/protected/ping', authGuard, (c) =>
      c.json({ message: 'pong', email: c.get('user').email }),
    );
  }
}
