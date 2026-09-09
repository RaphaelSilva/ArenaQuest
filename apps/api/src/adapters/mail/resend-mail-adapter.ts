import type { IMailer, MailMessage } from '@arenaquest/shared/ports';

export interface ResendMailAdapterConfig {
  apiKey: string;
  /** Verified sender address — must match a domain configured in Resend. */
  from: string;
}

/**
 * Raised when Resend rejects a message (or is unreachable). Carries the
 * HTTP status and the response body as plain fields so a caller can log
 * them as separate arguments — a Worker log viewer renders an Error as its
 * stack alone, which hides the one detail that identifies the failure.
 */
export class ResendSendError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'ResendSendError';
  }
}

/**
 * Resend mailer for staging/production. Uses Resend because it ships from
 * a Cloudflare Worker without any Node-runtime dependency — a single fetch
 * call with `Authorization: Bearer <RESEND_API_KEY>`.
 *
 * Documentation: https://resend.com/docs
 *
 * Errors are surfaced to the caller; the registration-mail handler catches
 * and logs them so a transient mailer outage cannot abort registration.
 */
export class ResendMailAdapter implements IMailer {
  constructor(private readonly config: ResendMailAdapterConfig) {}

  async send(message: MailMessage): Promise<void> {
    // A missing secret would otherwise become `Bearer undefined` and come
    // back as an opaque 401 from Resend — name the real cause instead.
    if (!this.config.apiKey) {
      throw new ResendSendError(
        'ResendMailAdapter: RESEND_API_KEY is empty — set it with ' +
          '`wrangler secret put RESEND_API_KEY --env <env>`',
        0,
        '',
      );
    }
    if (!this.config.from) {
      throw new ResendSendError('ResendMailAdapter: MAIL_FROM is empty', 0, '');
    }

    let res: Response;
    try {
      res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.from,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
    } catch (err) {
      throw new ResendSendError(
        `ResendMailAdapter: request to Resend failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
        '',
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      throw new ResendSendError(
        `ResendMailAdapter: send failed (${res.status}) from=${this.config.from}: ${body}`,
        res.status,
        body,
      );
    }
  }
}
