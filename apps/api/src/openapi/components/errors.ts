import { z } from '@hono/zod-openapi';

export const ErrorBody = z
  .object({
    error: z.string().openapi({ description: 'Error code or message' }),
  })
  .catchall(z.unknown())
  .openapi('ErrorBody', {
    description: 'Standard error response body with optional metadata fields',
    additionalProperties: true,
  });

export const ValidationErrorBody = z
  .object({
    error: z.literal('ValidationError').openapi({ description: 'Fixed error code for validation failures' }),
    issues: z.array(z.unknown()).openapi({
      description: 'Zod validation issues array',
      example: [
        {
          code: 'invalid_type',
          expected: 'string',
          received: 'undefined',
          path: ['email'],
          message: 'Required',
        },
      ],
    }),
  })
  .openapi('ValidationErrorBody', {
    description: 'Validation error response with Zod issues',
  });

/**
 * `409` on the two admin payment routes (RFC 0026 §5): a `method: 'gateway'`
 * payment whose `<provider>:<id>` reference is already on that rail's ledger.
 * Any other conflict on those routes keeps the generic `Conflict` code.
 */
export const PaymentConflictBody = z
  .object({
    error: z.string().openapi({
      description:
        '`PAYMENT_REFERENCE_EXISTS` when a gateway payment with this externalReference is already on the ledger; `Conflict` otherwise',
      example: 'PAYMENT_REFERENCE_EXISTS',
    }),
    message: z.string().optional(),
    paymentId: z.string().optional().openapi({
      description: 'With `PAYMENT_REFERENCE_EXISTS`: the id of the ledger row that already carries the reference',
    }),
  })
  .openapi('PaymentConflictBody');

export type ErrorBodyType = z.infer<typeof ErrorBody>;
export type ValidationErrorBodyType = z.infer<typeof ValidationErrorBody>;
