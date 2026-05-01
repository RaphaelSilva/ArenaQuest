import type { IMailer, MailMessage } from '@arenaquest/shared/ports';

export interface ResendMailAdapterConfig {
  apiKey: string;
  /** Verified sender address — must match a domain configured in Resend. */
  from: string;
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
    const res = await fetch('https://api.resend.com/emails', {
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

    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable>');
      throw new Error(`ResendMailAdapter: send failed (${res.status}): ${body}`);
    }
  }
}
