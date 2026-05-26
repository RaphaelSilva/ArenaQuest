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
import { D1ProgressRepository } from '@api/adapters/db/d1-progress-repository';
import { D1EnrollmentRepository } from '@api/adapters/db/d1-enrollment-repository';
import { D1QuestRepository } from '@api/adapters/db/d1-quest-repository';
import { D1BadgeRepository } from '@api/adapters/db/d1-badge-repository';
import { D1GamificationRepository } from '@api/adapters/db/d1-gamification-repository';
import { D1MissionRepository } from '@api/adapters/db/d1-mission-repository';
import { D1CommentRepository } from '@api/adapters/db/d1-comment-repository';
import { R2StorageAdapter } from '@api/adapters/storage/r2-storage-adapter';
import { KvRateLimiter } from '@api/adapters/rate-limit/kv-rate-limiter';
import { ConsoleMailAdapter } from '@api/adapters/mail/console-mail-adapter';
import { ResendMailAdapter } from '@api/adapters/mail/resend-mail-adapter';
import { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';
import { StreakEngine } from '@arenaquest/shared/domain/gamification/streak-engine';
import { QuestEvaluator } from '@arenaquest/shared/domain/gamification/quest-evaluator';
import { BadgeEngine } from '@arenaquest/shared/domain/gamification/badge-engine';
import { AuthService } from '@api/core/auth/auth-service';
import { buildRegistrationMailHandler } from '@api/core/registration/registration-mail-handler';
import { PasswordController } from '@api/controllers/password.controller';
import { AccountController } from '@api/controllers/account.controller';
import { GoogleOAuthController } from '@api/controllers/google-oauth.controller';
import { RegisterController } from '@api/controllers/register.controller';
import { ActivateController } from '@api/controllers/activate.controller';
import { parseCookieSameSite } from '@api/routes/auth.router';
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
  IMissionRepository,
  IActivationTokenRepository,
  IPasswordResetTokenRepository,
  IOAuthAccountRepository,
  IMailer,
} from '@arenaquest/shared/ports';

// ---------------------------------------------------------------------------
// Bounded-context group interfaces
// ---------------------------------------------------------------------------

export interface IdentityContext {
  users: IUserRepository;
  tokens: IRefreshTokenRepository;
  activationTokens: IActivationTokenRepository;
  passwordResetTokens: IPasswordResetTokenRepository;
  oauthAccounts: IOAuthAccountRepository;
  authService: AuthService;
}

export interface ContentContext {
  topics: ITopicNodeRepository;
  tags: ITagRepository;
  media: IMediaRepository;
  storage: IStorageAdapter;
}

export interface EngagementContext {
  taskRepo: ITaskRepository;
  taskStages: ITaskStageRepository;
  taskLinks: ITaskLinkingRepository;
  commentRepo: ICommentRepository;
}

export interface ProgressContext {
  progressRepo: IProgressRepository;
  enrollmentRepo: IEnrollmentRepository;
}

export interface GamificationContext {
  questRepo: IQuestRepository;
  badgeRepo: IBadgeRepository;
  gamificationRepo: IGamificationRepository;
  missionRepo: IMissionRepository;
  xpEngine?: XpEngine;
  streakEngine?: StreakEngine;
  questEvaluator?: QuestEvaluator;
  badgeEngine?: BadgeEngine;
}

export interface InfraContext {
  auth: IAuthAdapter;
  mailer: IMailer;
  rateLimiters: {
    login: IRateLimiter;
    register: IRateLimiter;
    activate: IRateLimiter;
    forgotPassword: IRateLimiter;
  };
  cors: {
    allowedOrigins?: string;
    strict: boolean;
  };
  cookies: {
    sameSite: 'Strict' | 'Lax' | 'None';
  };
}

export interface ControllersContext {
  passwordController: PasswordController;
  accountController: AccountController;
  googleOAuthController: GoogleOAuthController;
  registerController: RegisterController;
  activateController: ActivateController;
}

export interface AppContainer {
  identity: IdentityContext;
  content: ContentContext;
  engagement: EngagementContext;
  progress: ProgressContext;
  gamification: GamificationContext;
  infra: InfraContext;
  controllers: ControllersContext;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function buildContainer(env: Env): AppContainer {
  // Infra: auth adapter
  const auth = new JwtAuthAdapter({
    secret: env.JWT_SECRET,
    accessTokenExpiresInSeconds: 900, // 15 min
  });

  // Identity repos
  const users = new D1UserRepository(env.DB);
  const tokens = new D1RefreshTokenRepository(env.DB);
  const activationTokens = new D1ActivationTokenRepository(env.DB, users);
  const passwordResetTokens = new D1PasswordResetTokenRepository(env.DB);
  const oauthAccounts = new D1OAuthAccountRepository(env.DB);
  const authService = new AuthService(auth, users, tokens);

  // Content repos
  const topics = new D1TopicNodeRepository(env.DB);
  const tags = new D1TagRepository(env.DB);
  const media = new D1MediaRepository(env.DB);
  const storage = new R2StorageAdapter({
    bucket: env.R2,
    s3Endpoint: env.R2_S3_ENDPOINT,
    bucketName: env.R2_BUCKET_NAME,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicBase: env.R2_PUBLIC_BASE || undefined,
  });

  // Engagement repos
  const taskRepo = new D1TaskRepository(env.DB);
  const taskStages = new D1TaskStageRepository(env.DB);
  const taskLinks = new D1TaskLinkingRepository(env.DB);
  const commentRepo = new D1CommentRepository(env.DB);

  // Progress repos
  const progressRepo = new D1ProgressRepository(env.DB);
  const enrollmentRepo = new D1EnrollmentRepository(env.DB);

  // Gamification repos + engines
  const gamificationRepo = new D1GamificationRepository(env.DB);
  const questRepo = new D1QuestRepository(env.DB);
  const badgeRepo = new D1BadgeRepository(env.DB);
  const missionRepo = new D1MissionRepository(env.DB);

  const xpEngine = new XpEngine(
    gamificationRepo,
    (env as unknown as Record<string, string>)['GAMIFICATION_ENABLED'] !== 'false',
  );
  const streakEngine = new StreakEngine(
    gamificationRepo,
    (userId) => users.findById(userId).then(u => u?.timezone ?? null),
  );
  const questEvaluator = new QuestEvaluator(questRepo, missionRepo, xpEngine);
  const badgeEngine = new BadgeEngine(badgeRepo, gamificationRepo, missionRepo, xpEngine);

  // Infra: mail
  const mailer: IMailer = env.MAIL_DRIVER === 'resend'
    ? new ResendMailAdapter({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM })
    : new ConsoleMailAdapter();

  // Infra: rate limiters
  const loginLimiter = new KvRateLimiter(env.RATE_LIMIT_KV);
  const registerLimiter = new KvRateLimiter(env.RATE_LIMIT_KV, {
    windowMs: 15 * 60_000,
    maxAttempts: 5,
    lockoutMs: 15 * 60_000,
    prefix: 'rl:register:',
  });
  const activateLimiter = new KvRateLimiter(env.RATE_LIMIT_KV, {
    windowMs: 15 * 60_000,
    maxAttempts: 20,
    lockoutMs: 15 * 60_000,
    prefix: 'rl:activate:',
  });
  const forgotPasswordLimiter = new KvRateLimiter(env.RATE_LIMIT_KV, {
    windowMs: 60 * 60_000,
    maxAttempts: 3,
    lockoutMs: 60 * 60_000,
    prefix: 'rl:forgot:',
  });

  // Controllers
  const registrationEmitter = buildRegistrationMailHandler({
    users,
    tokens: activationTokens,
    mailer,
    duplicateNoticeStore: env.RATE_LIMIT_KV,
    webBaseUrl: env.WEB_BASE_URL || 'http://localhost:3000',
  });

  const passwordController = new PasswordController(
    auth,
    users,
    tokens,
    passwordResetTokens,
    mailer,
    env.WEB_BASE_URL || 'http://localhost:3000',
  );
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
  const registerController = new RegisterController(users, auth, registrationEmitter);
  const activateController = new ActivateController(activationTokens);

  return {
    identity: { users, tokens, activationTokens, passwordResetTokens, oauthAccounts, authService },
    content: { topics, tags, media, storage },
    engagement: { taskRepo, taskStages, taskLinks, commentRepo },
    progress: { progressRepo, enrollmentRepo },
    gamification: { questRepo, badgeRepo, gamificationRepo, missionRepo, xpEngine, streakEngine, questEvaluator, badgeEngine },
    infra: {
      auth,
      mailer,
      rateLimiters: { login: loginLimiter, register: registerLimiter, activate: activateLimiter, forgotPassword: forgotPasswordLimiter },
      cors: {
        allowedOrigins: env.ALLOWED_ORIGINS,
        // Enforce strict validation when ALLOWED_ORIGINS is configured; fall
        // back gracefully to localhost when the variable is absent (local dev).
        strict: env.ALLOWED_ORIGINS !== undefined && env.ALLOWED_ORIGINS.trim() !== '',
      },
      cookies: { sameSite: parseCookieSameSite(env.COOKIE_SAMESITE) },
    },
    controllers: { passwordController, accountController, googleOAuthController, registerController, activateController },
  };
}
