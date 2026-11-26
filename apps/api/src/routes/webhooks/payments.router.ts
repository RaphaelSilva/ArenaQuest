import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import {
  PaymentsWebhookController,
  WEBHOOK_MAX_BODY_BYTES,
} from '@api/controllers/payments-webhook.controller';
import { ErrorBody, PaymentsWebhookAckSchema } from '@api/openapi/components';
import type { InfraContext, PaymentsContext } from '@api/container';
import type { IRateLimiter } from '@arenaquest/shared/ports';

/**
 * The payment webhook, mounted at `/v1/webhooks/payments` (RFC 0026 §4).
 *
 * Mounted from `routes/index.ts`, beside `/events`, and **not** from
 * `routes/public/` (authenticated non-admin) — this surface is anonymous *and*
 * must reject, a third posture. It has no role: it has a signature.
 *
 * The pipeline's order is the contract: meter (`429`) → declared length
 * (`413`) → provider (`404`) → configuration (`500`) → the raw body, read once
 * and verified (`401`, nothing written) → the event recorded → processing.
 * The last four steps live in `PaymentsWebhookController`.
 *
 * It never sets `user`, never reads a token, and is the only router that reads
 * the raw body. Every response carries `Cache-Control: no-store`.
 */

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * Deliberately not an enum: an unknown provider must reach the handler and
 * answer `404`, the same as a known one this label does not bind.
 */
const ProviderParamSchema = z.object({
  provider: z.string().min(1).max(40).openapi({ example: 'mercadopago' }),
});

export const receivePaymentWebhookRoute = createRoute({
  method: 'post',
  path: '/{provider}',
  summary: 'Receive a payment provider webhook',
  description:
    'Anonymous, signed by the provider. A delivery is a **trigger only**: the body ' +
    'decides nothing but which payment to fetch from the provider, and the fetched ' +
    'state decides the outcome. Verified-but-unusable deliveries (`orphan`, ' +
    '`mismatch`) answer `200` and are recorded for an admin; the service\'s own ' +
    'failure answers `503` so the provider delivers again. The request body is the ' +
    'provider\'s own payload and is read raw, so no schema is declared for it.',
  tags: ['payments'],
  request: { params: ProviderParamSchema },
  responses: {
    200: {
      description: 'The delivery was verified and recorded',
      content: { 'application/json': { schema: PaymentsWebhookAckSchema } },
    },
    401: {
      description: 'The delivery is not authentic; nothing was written',
      content: { 'application/json': { schema: ErrorBody } },
    },
    404: {
      description: 'This label and environment do not bind the provider',
      content: { 'application/json': { schema: ErrorBody } },
    },
    413: {
      description: 'The body exceeds 64 KiB',
      content: { 'application/json': { schema: ErrorBody } },
    },
    429: {
      description: 'Too Many Requests (120 per minute per IP)',
      content: { 'application/json': { schema: ErrorBody } },
    },
    500: {
      description: '`PAYMENTS_CONFIG_INVALID`: the provider list or its secrets are invalid',
      content: { 'application/json': { schema: ErrorBody } },
    },
    503: {
      description: '`PAYMENTS_EVENT_FAILED`: processing failed; deliver again',
      content: { 'application/json': { schema: ErrorBody } },
    },
  },
});

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/** Set after the handler so every answer — a `429`, a validation `400` — carries it. */
const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
};

/**
 * `CF-Connecting-IP` is written by Cloudflare at the edge and cannot be forged
 * by a caller; `X-Forwarded-For` can, so it is not a fallback (see the events
 * router). An absent header shares one `unknown` bucket.
 */
function clientIpKey(c: Context): string {
  const ip = c.req.header('cf-connecting-ip');
  return ip && ip.length > 0 ? ip : 'unknown';
}

/**
 * Bounds the CPU spent on signature checks. It fails **open**: a KV outage
 * must not make a provider's deliveries bounce — the signature, not the meter,
 * is what authenticates.
 */
function buildRateLimit(limiter: IRateLimiter): MiddlewareHandler {
  return async (c, next) => {
    const key = clientIpKey(c);
    try {
      const state = await limiter.peek(key);
      if (!state.allowed) {
        c.header('Retry-After', String(state.retryAfterSeconds ?? 1));
        return c.json({ error: 'TooManyRequests' }, 429);
      }
      await limiter.hit(key);
    } catch {
      console.error('[rate-limit] webhooks limiter failed, failing open');
    }
    return next();
  };
}

/** Refuses on the declared length alone, before anything is read. */
const boundBody: MiddlewareHandler = async (c, next) => {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > WEBHOOK_MAX_BODY_BYTES) {
    return c.json({ error: 'PayloadTooLarge' }, 413);
  }
  return next();
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

type ErrorStatus = 401 | 404 | 413 | 500 | 503;

export function buildPaymentsWebhookRouter(slice: {
  payments: PaymentsContext;
  infra: InfraContext;
}): OpenAPIHono {
  const { config, gateways, gatewayService } = slice.payments;
  const controller = new PaymentsWebhookController(config, gateways, gatewayService);
  const router = new OpenAPIHono();

  router.use('*', noStore);
  router.use('*', buildRateLimit(slice.infra.rateLimiters.webhooks));
  router.use('*', boundBody);

  router.openapi(receivePaymentWebhookRoute, async (c) => {
    const headers: Record<string, string> = {};
    c.req.raw.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    const query: Record<string, string> = {};
    new URL(c.req.url).searchParams.forEach((value, name) => {
      if (!(name in query)) query[name] = value;
    });

    const result = await controller.receive({
      provider: c.req.valid('param').provider,
      readBody: () => c.req.text(),
      headers,
      query,
    });

    if (result.ok) return c.json(result.data, 200);
    return c.json({ error: result.error }, result.status as ErrorStatus);
  });

  return router;
}
