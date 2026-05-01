import type { MailMessage } from '@arenaquest/shared/ports';

export interface DuplicateRegistrationEmailInput {
  to: string;
  /** May be a generic placeholder when the existing record is unavailable. */
  name: string;
  loginUrl: string;
}

/**
 * Duplicate-registration notice — sent when someone attempts to register
 * with an email already on file. Contains NO activation link and NO token.
 * The whole point is to alert the legitimate owner without giving an attacker
 * any new capability beyond what they could already see in the public API
 * response (which is identical for fresh + duplicate emails).
 */
export function renderDuplicateRegistrationEmail(
  input: DuplicateRegistrationEmailInput,
): MailMessage {
  const safeName = escapeHtml(input.name);
  const safeUrl = escapeHtml(input.loginUrl);

  const subject = 'Tentativa de cadastro com seu e-mail';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#0b0d12;color:#e8eaf0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#141821;border-radius:16px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">Olá, ${safeName}.</h1>
        <p style="margin:0 0 16px;line-height:1.5;">
          Alguém tentou criar uma conta no <strong>ArenaQuest</strong> usando este endereço de e-mail.
          Se foi você, entre em sua conta normalmente:
        </p>
        <p style="margin:24px 0;text-align:center;">
          <a href="${safeUrl}"
             style="display:inline-block;padding:14px 28px;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:600;border-radius:10px;">
            Ir para login
          </a>
        </p>
        <p style="margin:0 0 16px;line-height:1.5;">
          Esqueceu a senha? Use a opção <strong>"Esqueci a senha"</strong> na tela de login.
        </p>
        <p style="margin:24px 0 0;font-size:13px;color:#a0a6b8;">
          Se não foi você, pode ignorar este e-mail com segurança — nenhuma conta nova foi criada.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `Olá, ${input.name}.`,
    '',
    'Alguém tentou criar uma conta no ArenaQuest usando este endereço de e-mail.',
    'Se foi você, entre normalmente:',
    input.loginUrl,
    '',
    'Esqueceu a senha? Use a opção "Esqueci a senha" na tela de login.',
    'Se não foi você, pode ignorar este e-mail com segurança.',
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
