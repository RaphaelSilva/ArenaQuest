import type { MailMessage } from '@arenaquest/shared/ports';

export interface ActivationEmailInput {
  to: string;
  name: string;
  activationUrl: string;
}

/**
 * Activation email — sent after a fresh-email registration. Inline styles
 * only; no MJML, no React Email. Two body forms (HTML + plain text) ship
 * together so screen readers and text-only clients still get a working URL.
 */
export function renderActivationEmail(input: ActivationEmailInput): MailMessage {
  const safeName = escapeHtml(input.name);
  const safeUrl = escapeHtml(input.activationUrl);

  const subject = 'Ative sua conta no ArenaQuest';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#0b0d12;color:#e8eaf0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#141821;border-radius:16px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">Olá, ${safeName}!</h1>
        <p style="margin:0 0 16px;line-height:1.5;">
          Recebemos seu cadastro no <strong>ArenaQuest</strong>. Para ativar sua conta e começar a jornada,
          clique no botão abaixo:
        </p>
        <p style="margin:24px 0;text-align:center;">
          <a href="${safeUrl}"
             style="display:inline-block;padding:14px 28px;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:600;border-radius:10px;">
            Ativar minha conta
          </a>
        </p>
        <p style="margin:0 0 8px;line-height:1.5;font-size:13px;color:#a0a6b8;">
          Se o botão não funcionar, copie e cole este endereço no seu navegador:
        </p>
        <p style="margin:0 0 16px;word-break:break-all;font-size:13px;color:#a0a6b8;">
          ${safeUrl}
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#a0a6b8;">
          O link expira em 24 horas. Se você não criou esta conta, ignore este e-mail.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `Olá, ${input.name}!`,
    '',
    'Recebemos seu cadastro no ArenaQuest. Para ativar sua conta, abra o link abaixo:',
    input.activationUrl,
    '',
    'O link expira em 24 horas. Se você não criou esta conta, ignore este e-mail.',
  ].join('\n');

  return { to: input.to, subject, html, text };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
