import type { MailMessage } from '@arenaquest/shared/ports';

export interface AdminPasswordResetEmailInput {
  to: string;
  name: string;
  temporaryPassword: string;
  adminNote?: string;
}

export function renderAdminPasswordResetEmail(input: AdminPasswordResetEmailInput): MailMessage {
  const safeName = escapeHtml(input.name);
  const safePassword = escapeHtml(input.temporaryPassword);
  const safeNote = input.adminNote ? escapeHtml(input.adminNote) : '';

  const subject = 'Sua senha no ArenaQuest foi redefinida por um administrador';

  const noteSection = safeNote
    ? `<p style="margin:16px 0;padding:16px;background:#1a1f2e;border-radius:8px;border-left:3px solid #7c5cff;font-size:14px;">
        <strong>Nota do administrador:</strong><br/>
        ${safeNote.replace(/\n/g, '<br/>')}
      </p>`
    : '';

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#0b0d12;color:#e8eaf0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#141821;border-radius:16px;padding:32px;">
      <tr><td>
        <h1 style="margin:0 0 16px;font-size:22px;color:#ffffff;">Olá, ${safeName}!</h1>
        <p style="margin:0 0 16px;line-height:1.5;">
          Sua senha no <strong>ArenaQuest</strong> foi redefinida por um administrador.
          Use a senha temporária abaixo para acessar sua conta:
        </p>
        <p style="margin:24px 0;padding:16px;background:#1a1f2e;border-radius:8px;text-align:center;font-family:'Courier New',monospace;">
          <span style="display:block;font-size:14px;color:#a0a6b8;margin-bottom:8px;">Senha temporária:</span>
          <span style="display:block;font-size:18px;font-weight:bold;color:#7c5cff;word-break:break-all;">${safePassword}</span>
        </p>
        <p style="margin:16px 0;padding:12px;background:#2a1a1a;border-left:3px solid #ff6b6b;border-radius:4px;font-size:13px;">
          ⚠️ <strong>Importante:</strong> Altere esta senha assim que possível acessando a página de Configurações da sua conta.
        </p>
        ${noteSection}
        <p style="margin:24px 0 0;font-size:13px;color:#a0a6b8;">
          Se você não esperava essa redefinição de senha, entre em contato com o administrador imediatamente.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    `Olá, ${input.name}!`,
    '',
    'Sua senha no ArenaQuest foi redefinida por um administrador.',
    'Use a senha temporária abaixo para acessar sua conta:',
    input.temporaryPassword,
    '',
    'IMPORTANTE: Altere esta senha assim que possível acessando a página de Configurações da sua conta.',
    ...(safeNote ? ['', 'Nota do administrador:', input.adminNote!] : []),
    '',
    'Se você não esperava essa redefinição de senha, entre em contato com o administrador imediatamente.',
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
