/**
 * Registration domain events emitted by RegisterController.
 *
 * Task 02 (activation email) subscribes to this emitter to send the
 * appropriate email per branch. Keep the surface deliberately small — a
 * function signature, not a queue — so the activation handler can plug in
 * without bringing in Durable Objects, cron, or a real outbox until truly
 * needed.
 *
 * Contract:
 *  - `USER_REGISTRATION_CREATED` fires once per fresh-email registration.
 *    `userId`/`email` are the persisted record's authoritative values.
 *  - `USER_REGISTRATION_DUPLICATE` fires once per registration attempt
 *    against an email that already exists. The activation handler is
 *    expected to send a "someone tried to register with your email"
 *    notice (no activation link).
 *  - Subscribers must NOT throw — emitter rejections are logged but do
 *    not abort the registration response.
 */
export type RegistrationEvent =
  | { type: 'USER_REGISTRATION_CREATED'; userId: string; email: string }
  | { type: 'USER_REGISTRATION_DUPLICATE'; email: string };

export type RegistrationEventEmitter = (event: RegistrationEvent) => void | Promise<void>;

export const noopRegistrationEmitter: RegistrationEventEmitter = () => {};
