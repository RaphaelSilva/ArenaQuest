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
import { D1UserGroupRepository } from '@api/adapters/db/d1-user-group-repository';
import { D1QuestRepository } from '@api/adapters/db/d1-quest-repository';
import { D1BadgeRepository } from '@api/adapters/db/d1-badge-repository';
import { D1GamificationRepository } from '@api/adapters/db/d1-gamification-repository';
import { D1MissionRepository } from '@api/adapters/db/d1-mission-repository';
import { D1CommentRepository } from '@api/adapters/db/d1-comment-repository';
import { D1NoteRepository } from '@api/adapters/db/d1-note-repository';
import { D1SubmissionRepository } from '@api/adapters/db/d1-submission-repository';
import { D1BillingRepository } from '@api/adapters/db/d1-billing-repository';
import { D1EventChargeRepository } from '@api/adapters/db/d1-event-charge-repository';
import { D1EventRepository } from '@api/adapters/db/d1-event-repository';
import { R2StorageAdapter } from '@api/adapters/storage/r2-storage-adapter';
import { KvRateLimiter } from '@api/adapters/rate-limit/kv-rate-limiter';
import { ConsoleMailAdapter } from '@api/adapters/mail/console-mail-adapter';
import { ResendMailAdapter } from '@api/adapters/mail/resend-mail-adapter';
import { XpEngine } from '@arenaquest/shared/domain/gamification/xp-engine';
import { StreakEngine } from '@arenaquest/shared/domain/gamification/streak-engine';
import { QuestEvaluator } from '@arenaquest/shared/domain/gamification/quest-evaluator';
import { BadgeEngine } from '@arenaquest/shared/domain/gamification/badge-engine';
import { AuthService } from '@api/core/auth/auth-service';
import {
  parseSubmissionConfig,
  type SubmissionConfigResult,
  type SubmissionEnv,
} from '@api/core/submissions/config';
import { BillingService } from '@api/core/billing/billing-service';
import { AccountingService } from '@api/core/billing/accounting-service';
import { EventChargeService } from '@api/core/billing/event-charge-service';
import { buildRegistrationMailHandler } from '@api/core/registration/registration-mail-handler';
import { PasswordController } from '@api/controllers/password.controller';
import { AccountController } from '@api/controllers/account.controller';
import { GoogleOAuthController } from '@api/controllers/google-oauth.controller';
import { RegisterController } from '@api/controllers/register.controller';
import { ActivateController } from '@api/controllers/activate.controller';
import { parseCookieSameSite } from '@api/routes/auth/login';
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
  IUserGroupRepository,
  IQuestRepository,
  IBadgeRepository,
  IGamificationRepository,
  ICommentRepository,
  INoteRepository,
  ISubmissionRepository,
  IMissionRepository,
  IActivationTokenRepository,
  IPasswordResetTokenRepository,
  IOAuthAccountRepository,
  IMailer,
  IBillingRepository,
  IEventChargeRepository,
  IEventRepository,
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
  userGroups: IUserGroupRepository;
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
  /** Student notes (RFC 0016). */
  noteRepo: INoteRepository;
  /** Student submissions (RFC 0020). */
  submissionRepo: ISubmissionRepository;
  /**
   * The parsed `SUBMISSIONS_*` vars — the parse *result*, not a config, so a
   * malformed var surfaces as `500 SUBMISSION_CONFIG_INVALID` on the submission
   * routes instead of failing every request at container build time.
   */
  submissionConfig: SubmissionConfigResult;
  /** Per-user presign budget (`rl:submissions:`, 30 per hour). */
  submissionRateLimiter: IRateLimiter;
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

/**
 * Billing (RFC 0013 §4). Built per request like every other group — Workers
 * share no memory between requests, so no instance may reach module scope.
 */
export interface BillingContext {
  billingRepo: IBillingRepository;
  billingService: BillingService;
  /** Read-only reporting over the same repository (RFC 0013 §5). */
  accountingService: AccountingService;
  /**
   * The extras rail's ledger (RFC 0015 §3): a sibling of `billingRepo`, never
   * merged into it — the two ledgers share rules, not rows.
   */
  eventChargeRepo: IEventChargeRepository;
  /** The extras rail's write rules (RFC 0015 §3), over `eventChargeRepo`. */
  eventChargeService: EventChargeService;
}

/**
 * Events board (RFC 0014 §6). Its own group because the board is a bounded
 * context of its own: an event is an announcement, and nothing here reads or
 * writes an enrollment, a topic or a grant of content access.
 */
export interface EventsContext {
  eventRepo: IEventRepository;
  /**
   * The same R2 adapter the content group holds, exposed here because the
   * flyer redirect mints its presigned GET through it. The bucket is never made
   * world-readable and the bytes are never proxied.
   */
  storage: IStorageAdapter;
  /**
   * Identity probes for the admin surface (Task 04).
   *
   * An audience grant names a user or a group, and the join tables carry
   * foreign keys: these two exist so that `PUT /{id}/audience` can refuse an
   * unknown id with a `422` instead of letting D1 surface it as a `500`. They
   * are the *same instances* the identity group holds — a second copy of a
   * per-request adapter, not a second adapter.
   */
  users: IUserRepository;
  userGroups: IUserGroupRepository;
}

export interface InfraContext {
  auth: IAuthAdapter;
  mailer: IMailer;
  rateLimiters: {
    login: IRateLimiter;
    register: IRateLimiter;
    activate: IRateLimiter;
    forgotPassword: IRateLimiter;
    /** The anonymous events board, keyed on `CF-Connecting-IP`. */
    events: IRateLimiter;
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
  billing: BillingContext;
  events: EventsContext;
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
  const noteRepo = new D1NoteRepository(env.DB);
  const submissionRepo = new D1SubmissionRepository(env.DB);
  // The vars are optional per environment, so the generated `Env` may not
  // declare them; read them structurally, as GAMIFICATION_ENABLED is below.
  const submissionConfig = parseSubmissionConfig(env as unknown as SubmissionEnv);

  // Identity: user groups
  const userGroups = new D1UserGroupRepository(env.DB);

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

  // Billing repo + service
  const billingRepo = new D1BillingRepository(env.DB);
  // Extras rail (RFC 0015). Per request like every adapter, next to its sibling.
  const eventChargeRepo = new D1EventChargeRepository(env.DB);
  // The probe is the only thing billing asks identity: `setHold` refuses an
  // unknown student with a 404 rather than letting the hold table's foreign key
  // surface as a 500.
  const userExists = (userId: string) => users.findById(userId).then((user) => user !== null);
  const billingService = new BillingService(billingRepo, userExists, eventChargeRepo);
  // Events repo (RFC 0014). The audience rule lives inside it and nowhere else.
  const eventRepo = new D1EventRepository(env.DB);

  // The statement 404s an unknown student, which is all billing needs from
  // identity — a probe rather than the repository, as `StreakEngine` does. The
  // extras ledger and the event titles are read-only inputs (RFC 0015 §7).
  const accountingService = new AccountingService(billingRepo, userExists, eventChargeRepo, eventRepo);

  // Extras rail service. It reads the event and its audience grants through
  // their ports, and the active currency through the billing port; it writes
  // only to its own ledger.
  const eventChargeService = new EventChargeService(eventChargeRepo, eventRepo, userGroups, billingRepo);

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
  // The events board is the one surface reachable without an account, so its
  // budget is per IP rather than per credential: 60 requests a minute, which a
  // reader browsing the board never approaches and a scraper hits immediately.
  // Its own prefix keeps it from sharing a bucket with a login attempt.
  const eventsLimiter = new KvRateLimiter(env.RATE_LIMIT_KV, {
    windowMs: 60_000,
    maxAttempts: 60,
    lockoutMs: 60_000,
    prefix: 'rl:events:',
  });

  // Student submissions (RFC 0020 §10): keyed by user id, presign only. It
  // bounds upload/delete churn, which a quota — a level, not a rate — does not.
  const submissionRateLimiter = new KvRateLimiter(env.RATE_LIMIT_KV, {
    windowMs: 60 * 60_000,
    maxAttempts: 30,
    lockoutMs: 60 * 60_000,
    prefix: 'rl:submissions:',
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
    identity: { users, tokens, activationTokens, passwordResetTokens, oauthAccounts, authService, userGroups },
    content: { topics, tags, media, storage },
    engagement: {
      taskRepo,
      taskStages,
      taskLinks,
      commentRepo,
      noteRepo,
      submissionRepo,
      submissionConfig,
      submissionRateLimiter,
    },
    progress: { progressRepo, enrollmentRepo },
    gamification: { questRepo, badgeRepo, gamificationRepo, missionRepo, xpEngine, streakEngine, questEvaluator, badgeEngine },
    billing: { billingRepo, billingService, accountingService, eventChargeRepo, eventChargeService },
    events: { eventRepo, storage, users, userGroups },
    infra: {
      auth,
      mailer,
      rateLimiters: { login: loginLimiter, register: registerLimiter, activate: activateLimiter, forgotPassword: forgotPasswordLimiter, events: eventsLimiter },
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
