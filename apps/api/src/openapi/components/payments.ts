import { z } from '@hono/zod-openapi';

/**
 * `200` of `POST /v1/webhooks/payments/{provider}` (RFC 0026 §4): what a
 * verified delivery came to. The service's own failure is never listed here —
 * it is the `503` that asks the provider to deliver again.
 */
export const PaymentsWebhookAckSchema = z
  .object({
    outcome: z.enum(['applied', 'duplicate', 'ignored', 'orphan', 'mismatch']).openapi({
      description:
        '`applied`: this delivery changed the ledger or a dispute state. `duplicate`: the event, or ' +
        'everything it named, was already recorded. `ignored`: nothing to do (a pending, failed or ' +
        'expired payment, or an event kind the adapter ignores). `orphan`: the provider does not know ' +
        'the payment, or it names no checkout of this provider. `mismatch`: the payment does not fit ' +
        'its checkout; nothing landed.',
      example: 'applied',
    }),
  })
  .openapi('PaymentsWebhookAck');
