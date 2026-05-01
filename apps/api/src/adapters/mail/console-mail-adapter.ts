import type { IMailer, MailMessage } from '@arenaquest/shared/ports';

/**
 * Local-development mailer: writes the rendered email to console.info so
 * engineers can copy the activation link from Wrangler stdout. Test code
 * can also pass an explicit `sink` to capture sent messages in-memory.
 */
export class ConsoleMailAdapter implements IMailer {
  constructor(private readonly sink: (message: MailMessage) => void = defaultSink) {}

  async send(message: MailMessage): Promise<void> {
    this.sink(message);
  }
}

function defaultSink(message: MailMessage): void {
  console.info(
    `[mail] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
  );
}
