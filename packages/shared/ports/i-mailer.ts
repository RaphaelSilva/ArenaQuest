/**
 * IMailer
 *
 * Cloud-agnostic outbound email port. Implementations live in
 * `apps/api/src/adapters/mail/` (e.g. Resend for staging/prod, Console for
 * dev + tests). No Cloudflare or Node types may leak into this signature —
 * a future Auth0 or AWS SES adapter must be a drop-in replacement.
 */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface IMailer {
  send(message: MailMessage): Promise<void>;
}
