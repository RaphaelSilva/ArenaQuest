import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { MiddlewareHandler } from 'hono';
import { MeBillingController } from '@api/controllers/me-billing.controller';
import { respondWith } from '@api/routes/_shared/envelope';
import { StudentStatementSchema, StandingSchema } from '@api/routes/admin/billing';
import {
  CheckoutSessionSchema,
  CheckoutStatusSchema,
  CreateCheckoutBodySchema,
  ErrorBody,
  ValidationErrorBody,
} from '@api/openapi/components';
import type { BillingContext, PaymentsContext } from '@api/container';

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
    "The caller's own standing, contracts, invoices with their payments, and outstanding total. It takes no parameters: the subject is the authenticated caller and there is no request that names another student. A member with no contract gets an empty statement with standing `good`, not a 404. `standing` and `outstandingMinor` are the contract rail only; the sibling `extras` object carries the caller's own event charges with their own standing — the two are never summed.",
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

// ---------------------------------------------------------------------------
// Checkouts (RFC 0026 §3)
// ---------------------------------------------------------------------------

const errorJson = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorBody } },
});

/** What every checkout route can answer before it looks at the request. */
const CHECKOUT_GATE_RESPONSES = {
  401: { description: 'Unauthenticated' },
  404: errorJson(
    'Not found. Also the answer of a label with no payment provider (`PAYMENTS_PROVIDERS = none`): ' +
      'the route does not exist there.',
  ),
  500: errorJson('`PAYMENTS_CONFIG_INVALID`: the provider list or its secrets are invalid'),
};

/**
 * `POST /v1/me/billing/checkouts` — pay one receivable of the caller's own.
 *
 * **Self-only by construction**, like the statement: the body names a
 * receivable (`kind`, `id`) and optionally a provider, and is `strict` — a
 * `userId` in it is a validation error, not an ignored field. The owner the
 * receivable must have is the token's `sub`.
 *
 * **It gates nothing and is gated by nothing**: a `delinquent` student opens a
 * checkout like anyone else.
 */
export const createMyCheckoutRoute = createRoute({
  method: 'post',
  path: '/billing/checkouts',
  summary: 'Pay One Of My Receivables',
  description:
    'Opens the hosted checkout for the **full open balance** of one invoice or event charge of the ' +
    'caller\'s own, or hands back the one already open. A receivable has one live checkout: a second ' +
    'call answers `200` with the same session while more than five minutes remain before its expiry, ' +
    'and replaces it otherwise; naming another provider cancels the first. The body names a ' +
    'receivable, never a user — anything that is not the caller\'s is `404`, as a missing one is. ' +
    'Refusals come in this order: `404` (no provider on this label) / `500 PAYMENTS_CONFIG_INVALID` → ' +
    '`400` → `404` → `409 RECEIVABLE_NOT_PAYABLE` → `409 PAYMENTS_UNSUPPORTED_CURRENCY` → `429` → ' +
    '`502 PAYMENTS_PROVIDER_ERROR`. Handing back an open checkout does not count toward the limit of ' +
    '10 new checkouts an hour. The provider is told to notify the API origin this request was made on ' +
    '(`<origin>/v1/webhooks/payments/<provider>`), so each environment receives the deliveries of its ' +
    'own checkouts. Sent with `Cache-Control: private, no-store`.',
  tags: ['me:billing'],
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateCheckoutBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: 'The receivable already had an open checkout; this is it',
      content: { 'application/json': { schema: CheckoutSessionSchema } },
    },
    201: {
      description: 'A new hosted checkout was opened',
      content: { 'application/json': { schema: CheckoutSessionSchema } },
    },
    400: {
      description:
        'Invalid body, or `PAYMENT_PROVIDER_REQUIRED`: several providers offer a method and none was ' +
        'named, or the one named offers no method on this label',
      content: { 'application/json': { schema: z.union([ErrorBody, ValidationErrorBody]) } },
    },
    ...CHECKOUT_GATE_RESPONSES,
    409: errorJson(
      '`RECEIVABLE_NOT_PAYABLE`: void, settled or with no balance. `PAYMENTS_UNSUPPORTED_CURRENCY`: the ' +
        'provider cannot settle the receivable\'s currency (decided before the provider is called). ' +
        '`CHECKOUT_IN_PROGRESS`: a concurrent request is opening this receivable\'s checkout — ask again.',
    ),
    429: errorJson('Too Many Requests: 10 new checkouts per hour per student (`Retry-After` is set)'),
    502: errorJson('`PAYMENTS_PROVIDER_ERROR`: the provider did not open the session; nothing is left open'),
  },
});

const CheckoutParamSchema = z.object({
  id: z.string().min(1).max(100).openapi({ description: 'The checkout id.' }),
});

export const myCheckoutRoute = createRoute({
  method: 'get',
  path: '/billing/checkouts/{id}',
  summary: 'My Checkout Status',
  description:
    'One checkout of the caller\'s own, as its row stands. **The provider is never called** — polling ' +
    'this costs one database read. The page a student returns to from the hosted checkout reads this ' +
    'and believes it, not the `outcome` in its own URL. A checkout that belongs to someone else is ' +
    '`404`, the same as one that does not exist. Sent with `Cache-Control: private, no-store`.',
  tags: ['me:billing'],
  security: [{ bearerAuth: [] }],
  request: { params: CheckoutParamSchema },
  responses: {
    200: {
      description: 'The checkout',
      content: { 'application/json': { schema: CheckoutStatusSchema } },
    },
    ...CHECKOUT_GATE_RESPONSES,
  },
});

/** Set after the handler, so a refusal — a `404`, a validation `400`, a `429` — carries it too. */
const privateNoStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Cache-Control', 'private, no-store');
};

type CheckoutErrorStatus = 400 | 404 | 409 | 429 | 500 | 502;

export function buildMeBillingRouter(slice: {
  billing: BillingContext;
  /** Absent on a wiring without a gateway: the checkout routes answer `404`. */
  payments?: Pick<PaymentsContext, 'gatewayService'>;
}): OpenAPIHono {
  const controller = new MeBillingController(
    slice.billing.billingService,
    slice.billing.accountingService,
    slice.payments?.gatewayService,
  );

  const router = new OpenAPIHono();

  // The checkout routes exist only where a provider is bound. Asked before the
  // body is validated, so a label under `none` answers `404` to anything — and
  // an invalid provider list is loud (`500`) rather than a quiet `404`.
  const checkoutGate: MiddlewareHandler = async (c, next) => {
    const closed = controller.checkoutGate();
    if (closed && !closed.ok) return c.json({ error: closed.error }, closed.status as CheckoutErrorStatus);
    return next();
  };
  for (const path of ['/billing/checkouts', '/billing/checkouts/*']) {
    router.use(path, privateNoStore);
    router.use(path, checkoutGate);
  }

  router.openapi(myBillingRoute, async (c) => {
    // The token's `sub`, and no other input. Nothing is read from the path, the
    // query, a header or a body — there is none of any of them to read.
    const result = await controller.getMyStatement(c.get('user').sub);
    return respondWith(c, result);
  });

  router.openapi(createMyCheckoutRoute, async (c) => {
    // The token's `sub` is the owner and the creator; the body names no user.
    // The provider notifies the API that created the checkout: this request's own origin.
    const result = await controller.createMyCheckout(c.get('user').sub, c.req.valid('json'), new URL(c.req.url).origin);
    if (result.ok) return c.json(result.data.checkout, result.data.created ? 201 : 200);
    if (result.status === 429) c.header('Retry-After', String(result.meta?.retryAfterSeconds ?? 1));
    return c.json({ error: result.error }, result.status as CheckoutErrorStatus);
  });

  router.openapi(myCheckoutRoute, async (c) => {
    const result = await controller.getMyCheckout(c.get('user').sub, c.req.valid('param').id);
    if (result.ok) return c.json(result.data, 200);
    return c.json({ error: result.error }, result.status as CheckoutErrorStatus);
  });

  return router;
}
