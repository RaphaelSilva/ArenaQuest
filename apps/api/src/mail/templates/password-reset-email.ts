import type { MailMessage } from '@arenaquest/shared/ports';

export interface PasswordResetEmailInput {
  to: string;
  name: string;
  resetUrl: string;
}

export function renderPasswordResetEmail(input: PasswordResetEmailInput): MailMessage {
  const safeName = escapeHtml(input.name);
  const safeUrl = escapeHtml(input.resetUrl);

  const subject = 'Redefina sua senha no ArenaQuest';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#0b0d12;color:#e8eaf0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#141821;border-radius:16px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">Olá, ${safeName}!</h1>
        <p style="margin:0 0 16px;line-height:1.5;">
          Recebemos uma solicitação para redefinir a senha da sua conta no <strong>ArenaQuest</strong>.
          Clique no botão abaixo para criar uma nova senha:
        </p>
        <p style="margin:24px 0;text-align:center;">
          <a href="${safeUrl}"
             style="display:inline-block;padding:14px 28px;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:600;border-radius:10px;">
            Redefinir minha senha
          </a>
        </p>
        <p style="margin:0 0 8px;line-height:1.5;font-size:13px;color:#a0a6b8;">
          Se o botão não funcionar, copie e cole este endereço no seu navegador:
        </p>
        <p style="margin:0 0 16px;word-break:break-all;font-size:13px;color:#a0a6b8;">
          ${safeUrl}
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#a0a6b8;">
          Este link expira em <strong>1 hora</strong>. Se você não solicitou a redefinição de senha,
          ignore este e-mail — sua conta continua segura.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `Olá, ${input.name}!`,
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta no ArenaQuest.',
    'Acesse o link abaixo para criar uma nova senha:',
    input.resetUrl,
    '',
    'Este link expira em 1 hora.',
    'Se você não solicitou a redefinição de senha, ignore este e-mail — sua conta continua segura.',
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
