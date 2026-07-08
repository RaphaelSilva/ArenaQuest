import { z } from '@hono/zod-openapi';

export const PaginationQuery = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .positive()
      .default(20)
      .optional()
      .openapi({
        param: {
          name: 'limit',
          in: 'query',
        },
        description: 'Number of items to return',
        example: 20,
      }),
    offset: z.coerce
      .number()
      .int()
      .nonnegative()
      .default(0)
      .optional()
      .openapi({
        param: {
          name: 'offset',
          in: 'query',
        },
        description: 'Number of items to skip',
        example: 0,
      }),
  })
  .openapi('PaginationQuery', {
    description: 'Pagination query parameters',
  });

export function PaginatedResponse<T extends z.ZodTypeAny>(schema: T) {
  return z
    .object({
      data: z.array(schema).openapi({
        description: 'Array of items',
      }),
      total: z.number().int().nonnegative().optional().openapi({
        description: 'Total number of items available',
        example: 100,
      }),
    })
    .openapi('PaginatedResponse', {
      description: 'Paginated response with items and optional total count',
    });
}

export type PaginationQueryType = z.infer<typeof PaginationQuery>;
