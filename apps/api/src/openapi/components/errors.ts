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

export type ErrorBodyType = z.infer<typeof ErrorBody>;
export type ValidationErrorBodyType = z.infer<typeof ValidationErrorBody>;
