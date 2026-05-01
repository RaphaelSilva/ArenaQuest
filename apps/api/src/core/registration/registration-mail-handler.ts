import type {
  IActivationTokenRepository,
  IMailer,
  IUserRepository,
} from '@arenaquest/shared/ports';
import { toMilliseconds } from '@arenaquest/shared/domain/time';
import { renderActivationEmail } from '@api/mail/templates/activation-email';
import { renderDuplicateRegistrationEmail } from '@api/mail/templates/duplicate-registration-email';
import type {
  RegistrationEvent,
  RegistrationEventEmitter,
} from '@api/core/registration/registration-events';

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = toMilliseconds(24, 'hours');
const DUPLICATE_NOTICE_TTL_SECONDS = 24 * 60 * 60;

export interface RegistrationMailHandlerDeps {
  users: IUserRepository;
  tokens: IActivationTokenRepository;
  mailer: IMailer;
  /**
   * KV namespace used to enforce "at most one duplicate-registration notice
   * per email per 24h" — without it an attacker scraping addresses could
   * spam a victim's inbox via the public registration endpoint.
   */
  duplicateNoticeStore: Pick<KVNamespace, 'get' | 'put'>;
  /** e.g. `https://arenaquest-web.pages.dev` — never trailing-slashed. */
  webBaseUrl: string;
}

/**
 * Subscribes to the in-process registration emitter (Task 01) and turns
 * domain events into the appropriate side-effect: a single-use activation
 * email for fresh registrations, an idempotent duplicate-registration
 * notice for collisions. Subscribers MUST NOT throw — failures are logged
 * so a transient mailer / KV outage cannot abort the registration response.
 */
export function buildRegistrationMailHandler(
  deps: RegistrationMailHandlerDeps,
): RegistrationEventEmitter {
  const { users, tokens, mailer, duplicateNoticeStore, webBaseUrl } = deps;
  const baseUrl = webBaseUrl.replace(/\/+$/, '');

  return async (event: RegistrationEvent) => {
    try {
      if (event.type === 'USER_REGISTRATION_CREATED') {
        const plainToken = generateActivationToken();
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
        await tokens.create({
          plainToken,
          userId: event.userId,
          expiresAt,
        });

        const user = await users.findById(event.userId);
        const message = renderActivationEmail({
          to: event.email,
          name: user?.name ?? 'aluno(a)',
          activationUrl: `${baseUrl}/activate?token=${plainToken}`,
        });
        await mailer.send(message);
        return;
      }

      // DUPLICATE branch — at most one notice per email per 24h.
      const idempotencyKey = `dup-reg:${event.email}`;
      const seen = await duplicateNoticeStore.get(idempotencyKey);
      if (seen) return;

      const existing = await users.findByEmail(event.email);
      const message = renderDuplicateRegistrationEmail({
        to: event.email,
        name: existing?.name ?? 'aluno(a)',
        loginUrl: `${baseUrl}/login`,
      });
      await mailer.send(message);
      await duplicateNoticeStore.put(idempotencyKey, '1', {
        expirationTtl: DUPLICATE_NOTICE_TTL_SECONDS,
      });
    } catch (err) {
      console.error('[registration-mail] handler failed', event.type, err);
    }
  };
}

/**
 * 32 random bytes encoded as base64url. The space (~10^77) makes
 * online guessing infeasible regardless of rate limits.
 */
function generateActivationToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
