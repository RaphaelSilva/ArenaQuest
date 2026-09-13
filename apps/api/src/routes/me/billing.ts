import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { MeBillingController } from '@api/controllers/me-billing.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import { StudentStatementSchema, StandingSchema } from '@api/routes/admin/billing';
import type { BillingContext } from '@api/container';

/**
 * `GET /v1/me/billing` — the caller's own statement (RFC 0013 §2, §3).
 *
 * **Self-only by construction.** The route declares no `request` at all: no
 * path parameter, no query, no header and no body. The subject is the `sub` of
 * the verified access token and there is nothing else it could be, so no
 * request this endpoint accepts can name another student. An admin reading
 * someone else's statement uses `GET /v1/admin/billing/students/{userId}/statement`,
 * behind `requireRole(ADMIN)`.
 *
 * **It carries no role guard and adds no guard to anything.** `/v1/me/*`
 * already runs `authGuard` at the sub-app level, which is the whole of the
 * protection this needs; a student reads their own money and nothing else
 * changes. A `delinquent` standing in the response is a label — there is no
 * `402`, no read-only mode and no per-topic paywall anywhere behind it.
 */

/**
 * The admin's statement shape plus the resolved standing. It extends the
 * exported instance rather than re-declaring the fields, so the student and the
 * admin can never drift into reading two different statements.
 */
const MyBillingStatementSchema = StudentStatementSchema.extend({
  standing: StandingSchema,
  oldestOverdueDate: z.string().nullable().openapi({ example: '2026-02-10' }),
  asOf: z.string().openapi({ example: '2026-03-01' }),
}).openapi('MyBillingStatement');

export const myBillingRoute = createRoute({
  method: 'get',
  path: '/billing',
  summary: 'My Billing Statement',
  description:
    "The caller's own standing, contracts, invoices with their payments, and outstanding total. It takes no parameters: the subject is the authenticated caller and there is no request that names another student. A member with no contract gets an empty statement with standing `good`, not a 404.",
  tags: ['me:billing'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'The caller’s statement',
      content: { 'application/json': { schema: MyBillingStatementSchema } },
    },
    401: { description: 'Unauthenticated' },
  },
});

export function buildMeBillingRouter(slice: { billing: BillingContext }): OpenAPIHono {
  const controller = new MeBillingController(
    slice.billing.billingService,
    slice.billing.accountingService,
  );

  const router = new OpenAPIHono();

  router.openapi(myBillingRoute, async (c) => {
    // The token's `sub`, and no other input. Nothing is read from the path, the
    // query, a header or a body — there is none of any of them to read.
    const result = await controller.getMyStatement(c.get('user').sub);
    return respondWith(c, result);
  });

  return router;
}
