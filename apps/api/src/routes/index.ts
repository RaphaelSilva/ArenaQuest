import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { buildAuthRouter } from './auth.router';
import { buildAdminUsersRouter } from './admin-users.router';
import { getHealth } from '@api/controllers/health.controller';
import { authGuard } from '@api/middleware/auth-guard';
import type { IAuthAdapter, IUserRepository } from '@arenaquest/shared/ports';
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
      authService: AuthService;
      allowedOrigin?: string;
    },
  ): void {
    const { auth, users, authService, allowedOrigin } = deps;

    // Enable CORS for frontend interaction
    app.use(
      '*',
      cors({
        origin: allowedOrigin ?? 'http://localhost:3000',
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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
    app.route('/auth', buildAuthRouter(authService));
    app.route('/admin/users', buildAdminUsersRouter(users, auth));

    // Sanity demo — development only, can be removed post-milestone.
    app.get('/protected/ping', authGuard, (c) =>
      c.json({ message: 'pong', email: c.get('user').email }),
    );
  }
}
