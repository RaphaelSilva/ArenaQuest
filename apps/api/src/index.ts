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
import { D1MediaRepository } from '@api/adapters/db/d1-media-repository';
import { D1TaskRepository } from '@api/adapters/db/d1-task-repository';
import { D1TaskStageRepository } from '@api/adapters/db/d1-task-stage-repository';
import { D1TaskLinkingRepository } from '@api/adapters/db/d1-task-linking-repository';
import { D1ActivationTokenRepository } from '@api/adapters/db/d1-activation-token-repository';
import { D1PasswordResetTokenRepository } from '@api/adapters/db/d1-password-reset-token-repository';
import { D1OAuthAccountRepository } from '@api/adapters/db/d1-oauth-account-repository';
import { PasswordController } from '@api/controllers/password.controller';
import { AccountController } from '@api/controllers/account.controller';
import { GoogleOAuthController } from '@api/controllers/google-oauth.controller';
import { D1ProgressRepository } from '@api/adapters/db/d1-progress-repository';
import { D1EnrollmentRepository } from '@api/adapters/db/d1-enrollment-repository';
import { D1QuestRepository } from '@api/adapters/db/d1-quest-repository';
import { D1BadgeRepository } from '@api/adapters/db/d1-badge-repository';
import { D1GamificationRepository } from '@api/adapters/db/d1-gamification-repository';
import { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';
import { StreakEngine } from '@arenaquest/shared/domain/gamification/streak-engine';
import { QuestEvaluator } from '@arenaquest/shared/domain/gamification/quest-evaluator';
import { BadgeEngine } from '@arenaquest/shared/domain/gamification/badge-engine';
import { D1MissionRepository } from '@api/adapters/db/d1-mission-repository';
import { R2StorageAdapter } from '@api/adapters/storage/r2-storage-adapter';
import { KvRateLimiter } from '@api/adapters/rate-limit/kv-rate-limiter';
import { ConsoleMailAdapter } from '@api/adapters/mail/console-mail-adapter';
import { ResendMailAdapter } from '@api/adapters/mail/resend-mail-adapter';
import { AuthService } from '@api/core/auth/auth-service';
import { RegisterController } from '@api/controllers/register.controller';
import { ActivateController } from '@api/controllers/activate.controller';
import { buildRegistrationMailHandler } from '@api/core/registration/registration-mail-handler';
import type { IMailer } from '@arenaquest/shared/ports';
import type { RegistrationEventEmitter } from '@api/core/registration/registration-events';
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
  const media = new D1MediaRepository(env.DB);
  const taskRepo = new D1TaskRepository(env.DB);
  const taskStages = new D1TaskStageRepository(env.DB);
  const taskLinks = new D1TaskLinkingRepository(env.DB);
  const progressRepo = new D1ProgressRepository(env.DB);
  const enrollmentRepo = new D1EnrollmentRepository(env.DB);
  const questRepo = new D1QuestRepository(env.DB);
  const badgeRepo = new D1BadgeRepository(env.DB);
  const gamificationRepo = new D1GamificationRepository(env.DB);
  const xpEngine = new XpEngine(gamificationRepo, (env as unknown as Record<string, string>)['GAMIFICATION_ENABLED'] !== 'false');
  const streakEngine = new StreakEngine(
    gamificationRepo,
    (userId) => users.findById(userId).then(u => u?.timezone ?? null),
  );
  const missionRepo = new D1MissionRepository(env.DB);
  const questEvaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);
  const badgeEngine = new BadgeEngine(badgeRepo, gamificationRepo, missionRepo, xpEngine);
  const storage = new R2StorageAdapter({
    bucket: env.R2,
    s3Endpoint: env.R2_S3_ENDPOINT,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicBase: env.R2_PUBLIC_BASE || undefined,
  });
  const authService = new AuthService(auth, users, tokens);
  const loginLimiter = new KvRateLimiter(env.RATE_LIMIT_KV);

  // Registration limiter: separate KV-prefixed bucket so login lockouts and
  // registration throttles can never bleed into each other. 5 attempts per
  // 15-minute window mirrors the spec for `POST /auth/register`.
  const registerLimiter = new KvRateLimiter(env.RATE_LIMIT_KV, {
    windowMs: 15 * 60_000,
    maxAttempts: 5,
    lockoutMs: 15 * 60_000,
    prefix: 'rl:register:',
  });

  // Activation flow wiring (Task 02):
  //  - Console mailer when MAIL_DRIVER=console (local dev / tests).
  //  - Resend mailer otherwise — single-fetch HTTP API, no Node deps.
  const mailer: IMailer = env.MAIL_DRIVER === 'resend'
    ? new ResendMailAdapter({
        apiKey: env.RESEND_API_KEY,
        from: env.MAIL_FROM,
      })
    : new ConsoleMailAdapter();

  const activationTokens = new D1ActivationTokenRepository(env.DB, users);
  const passwordResetTokens = new D1PasswordResetTokenRepository(env.DB);
  const passwordController = new PasswordController(
    auth,
    users,
    tokens,
    passwordResetTokens,
    mailer,
    env.WEB_BASE_URL || 'http://localhost:3000',
  );

  const oauthAccounts = new D1OAuthAccountRepository(env.DB);
  const accountController = new AccountController(auth, users, tokens);
  const googleOAuthController = new GoogleOAuthController(
    {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
      webBaseUrl: env.WEB_BASE_URL || 'http://localhost:3000',
    },
    env.RATE_LIMIT_KV,
    oauthAccounts,
    users,
    authService,
  );

  const forgotPasswordLimiter = new KvRateLimiter(env.RATE_LIMIT_KV, {
    windowMs: 60 * 60_000,
    maxAttempts: 3,
    lockoutMs: 60 * 60_000,
    prefix: 'rl:forgot:',
  });

  const registrationEmitter: RegistrationEventEmitter = buildRegistrationMailHandler({
    users,
    tokens: activationTokens,
    mailer,
    duplicateNoticeStore: env.RATE_LIMIT_KV,
    webBaseUrl: env.WEB_BASE_URL || 'http://localhost:3000',
  });

  const registerController = new RegisterController(users, auth, registrationEmitter);
  const activateController = new ActivateController(activationTokens);

  // Activation limiter: 20 attempts per 15-min window keyed by IP.
  const activateLimiter = new KvRateLimiter(env.RATE_LIMIT_KV, {
    windowMs: 15 * 60_000,
    maxAttempts: 20,
    lockoutMs: 15 * 60_000,
    prefix: 'rl:activate:',
  });

  const app = new Hono();

  AppRouter.register(app, {
    auth,
    users,
    tokens,
    topics,
    tags,
    media,
    storage,
    taskRepo,
    taskStages,
    taskLinks,
    progressRepo,
    enrollmentRepo,
    questRepo,
    badgeRepo,
    gamificationRepo,
    missionRepo,
    xpEngine,
    streakEngine,
    questEvaluator,
    badgeEngine,
    authService,
    loginLimiter,
    registerController,
    registerLimiter,
    activateController,
    activateLimiter,
    passwordController,
    forgotPasswordLimiter,
    accountController,
    googleOAuthController,
    cookieSameSite: parseCookieSameSite(env.COOKIE_SAMESITE),
    allowedOrigins: env.ALLOWED_ORIGINS,
    // If ALLOWED_ORIGINS is configured, enforce strict validation — an invalid
    // origin list should fail loudly at boot rather than silently allow all.
    // If the variable is absent (local dev), fall back gracefully to localhost.
    strictCors: env.ALLOWED_ORIGINS !== undefined && env.ALLOWED_ORIGINS.trim() !== '',
  });

  return app;
}

export default {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    return buildApp(env).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<AppEnv>;
