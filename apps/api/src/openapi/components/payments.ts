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

// ---------------------------------------------------------------------------
// Checkouts and pay options (RFC 0026 §3, §7)
// ---------------------------------------------------------------------------

const ProviderNameSchema = z.enum(['stripe', 'mercadopago', 'asaas', 'pagarme']).openapi({ example: 'mercadopago' });

const ReceivableKindSchema = z.enum(['invoice', 'event_charge']).openapi({ example: 'invoice' });

/** One way to pay on this label: a provider and the methods it offers, in list order. */
export const PayOptionSchema = z
  .object({
    provider: ProviderNameSchema,
    methods: z.array(z.enum(['pix', 'card', 'boleto'])).min(1).openapi({ example: ['pix', 'card'] }),
  })
  .openapi('PayOption');

/**
 * The live hosted checkout of one receivable. It carries no URL: *Open again*
 * calls `POST /v1/me/billing/checkouts`, which answers the same session.
 */
export const PendingCheckoutSchema = z
  .object({
    checkoutId: z.string(),
    provider: ProviderNameSchema,
    createdAt: z.string().openapi({ example: '2026-11-26T14:03:00.000Z' }),
    expiresAt: z.string().openapi({ example: '2026-11-27T14:03:00.000Z' }),
    createdBy: z.string().openapi({
      description: 'The student, or the admin who opened it on their behalf.',
    }),
  })
  .openapi('PendingCheckout');

/** Body of `POST /v1/me/billing/checkouts`: a receivable of the caller's own — never a user. */
export const CreateCheckoutBodySchema = z
  .object({
    kind: ReceivableKindSchema,
    id: z.string().min(1).max(100).openapi({ description: 'The invoice or event charge id.' }),
    provider: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .openapi({
        description:
          'Required when several providers offer a method (see `payOptions`); one that offers ' +
          'nothing on this label is `400 PAYMENT_PROVIDER_REQUIRED`.',
        example: 'mercadopago',
      }),
  })
  .strict()
  .openapi('CreateCheckoutBody');

/** A hosted session the caller can be sent to. */
export const CheckoutSessionSchema = z
  .object({
    checkoutId: z.string(),
    provider: ProviderNameSchema,
    url: z.string().openapi({
      description: 'The provider\'s hosted page. Open it in a new tab; never in a frame.',
      example: 'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=123',
    }),
    expiresAt: z.string().openapi({
      description: 'The earlier of the provider\'s own expiry and 24 hours from creation.',
      example: '2026-11-27T14:03:00.000Z',
    }),
    amountMinor: z.number().int().openapi({
      description: 'The receivable\'s full open balance when the checkout was created.',
      example: 15000,
    }),
    currency: z.string().openapi({ example: 'BRL' }),
    status: z.enum(['open']),
  })
  .openapi('CheckoutSession');

/** One checkout as its row stands; the provider is not asked. */
export const CheckoutStatusSchema = z
  .object({
    checkoutId: z.string(),
    provider: ProviderNameSchema,
    kind: ReceivableKindSchema,
    receivableId: z.string(),
    status: z.enum(['open', 'paid', 'expired', 'cancelled', 'failed', 'mismatch']).openapi({
      description:
        '`open`: no payment confirmed yet (a Pix may be confirmed minutes after the redirect). ' +
        '`paid`: the money is on the ledger — refetch the statement. Anything else: this attempt is over.',
      example: 'open',
    }),
    amountMinor: z.number().int().openapi({ example: 15000 }),
    currency: z.string().openapi({ example: 'BRL' }),
    createdAt: z.string(),
    expiresAt: z.string(),
    closedAt: z.string().nullable(),
  })
  .openapi('CheckoutStatus');

// ---------------------------------------------------------------------------
// The admin's side (RFC 0026 §3, §5, §7)
// ---------------------------------------------------------------------------

/**
 * Body of the two on-behalf checkout routes. The receivable is the path's and
 * its student is read from it; the body only says how to pay.
 */
export const CreateCheckoutOnBehalfBodySchema = z
  .object({
    provider: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .openapi({
        description:
          'Required when several providers offer a method (see the statement\'s `payOptions`); one ' +
          'that offers nothing on this label is `400 PAYMENT_PROVIDER_REQUIRED`.',
        example: 'mercadopago',
      }),
  })
  .strict()
  .openapi('CreateCheckoutOnBehalfBody');

/**
 * "Pending online payment" on one roster line: how many of the student's open
 * receivables — contract invoices and event charges together — have a hosted
 * checkout in progress. A count of links, never an amount.
 */
export const PendingCheckoutsSummarySchema = z
  .object({
    count: z.number().int().min(0).openapi({ example: 1 }),
    earliestExpiresAt: z.string().nullable().openapi({
      description: 'When the first of them expires; `null` when `count` is 0.',
      example: '2026-11-27T14:03:00.000Z',
    }),
  })
  .openapi('PendingCheckoutsSummary');

/** `409` of the two reverse routes when the row is a gateway payment. */
export const RefundConflictBody = z
  .object({
    error: z.string().openapi({
      description:
        '`PAYMENTS_PROVIDER_NOT_ENABLED`: the payment\'s provider is not bound on this label any more. ' +
        '`PAYMENTS_REFUND_REFUSED`: the provider did not return the money, does not know the payment, or ' +
        'already holds a partial refund of it. `Conflict`: the row is itself a reversal, or was already ' +
        'reversed. In every case nothing was written.',
      example: 'PAYMENTS_REFUND_REFUSED',
    }),
    message: z.string().optional(),
  })
  .openapi('RefundConflictBody');

/** `503` of the two reverse routes: the money was returned and the ledger does not say so yet. */
export const RefundUnrecordedBody = z
  .object({
    error: z.literal('PAYMENTS_REFUND_UNRECORDED'),
    refundId: z.string().openapi({
      description:
        'The provider\'s refund id. The refund **happened**; repeat the same request to record it — it ' +
        'cannot refund twice.',
      example: '1234567890',
    }),
  })
  .openapi('RefundUnrecordedBody');

/**
 * `503` of the two reverse routes when the provider could not take the request
 * right now. Not a refusal and not a refund: nothing was written.
 */
export const RefundBusyBody = z
  .object({
    error: z.literal('PAYMENTS_PROVIDER_BUSY').openapi({
      description:
        'The provider rate-limited the request or did not answer in time. Repeat the same request after ' +
        'a few seconds: a refund the provider did accept is found and recorded, never asked for twice.',
    }),
  })
  .openapi('RefundBusyBody');

// ---------------------------------------------------------------------------
// Reconcile run and exceptions (RFC 0026 §6, §7)
// ---------------------------------------------------------------------------

const count = (description: string) => z.number().int().min(0).openapi({ description, example: 0 });

/** The counts of one reconcile run — also what `job_runs.summary` holds for `reconcile_payments`. */
export const ReconcilePaymentsSummarySchema = z
  .object({
    checkoutsDue: count('Checkouts due when the run started.'),
    checkoutsAsked: count('Provider searches made — at most 25 per run.'),
    landed: count('Payments the provider held whose checkout is now `paid`.'),
    expired: count('Checkouts closed `expired` after the provider reported nothing paid.'),
    stillOpen: count('Asked, nothing paid yet, not yet expired.'),
    abandoned: count('Open with no provider session for over 30 minutes: closed `failed`, no provider call.'),
    unreachable: count('On a provider that is no longer bound: expired without being asked. Non-zero fails the run.'),
    mismatched: count('A payment was found that does not fit its checkout; see the exceptions list.'),
    checkoutErrors: count('The provider could not be asked; tried again next run.'),
    checkoutsDeferred: count('Due and left for the next run.'),
    eventsDue: count('Unsettled events due when the run started.'),
    eventsRetried: count('Events processed again — at most 10 per run.'),
    eventsSettled: count('Of those, how many reached a final outcome.'),
    eventsFailed: count('Of those, how many failed again.'),
    eventsDeferred: count('Due and left for the next run.'),
    staleOrphans: count('`orphan` events older than 7 days, not dismissed.'),
    staleMismatches: count('`mismatch` events and checkouts older than 7 days, not dismissed.'),
  })
  .openapi('ReconcilePaymentsSummary');

/** `200` of `POST /v1/admin/billing/payments/reconcile`. A failed run is still a `200`: the verdict is in the body. */
export const ReconcilePaymentsRunSchema = z
  .object({
    status: z.enum(['ok', 'failed']).openapi({
      description: '`failed` when a checkout sat on a provider that is no longer bound (`unreachable > 0`).',
      example: 'ok',
    }),
    error: z.string().nullable().openapi({ description: 'Why the run failed; `null` on `ok`.', example: null }),
    keyMode: z.enum(['test', 'live']).openapi({
      description:
        'What `PAYMENTS_KEY_MODE` declares for this environment. A reminder of which credentials the ' +
        'integrator says are installed: the run inspects no key and verifies nothing against it.',
      example: 'test',
    }),
    summary: ReconcilePaymentsSummarySchema,
  })
  .openapi('ReconcilePaymentsRun');

/** One row of the exceptions list. Ids and states only. */
export const PaymentExceptionSchema = z
  .object({
    ref: z.string().openapi({
      description:
        'Stable handle for dismissal: `event:<provider>:<eventId>` or `checkout:<checkoutId>`. Opaque to the client — send it back as is.',
      example: 'event:mercadopago:123456789',
    }),
    kind: z.enum(['orphan', 'mismatch', 'failed', 'received', 'dispute']).openapi({
      description:
        '`orphan`: a provider payment that names no checkout of ours. `mismatch`: a payment that does not fit its checkout — nothing landed. ' +
        '`failed`: processing failed and is retried for 72 hours. `received`: left unprocessed for over an hour. ' +
        '`dispute`: a chargeback on a landed payment (`detail` reads `dispute opened|won|lost`).',
      example: 'orphan',
    }),
    source: z.enum(['event', 'checkout']).openapi({ description: 'Which record the row stands for.' }),
    provider: ProviderNameSchema,
    eventId: z.string().nullable().openapi({ description: 'The provider\'s notification id; `null` for a checkout row.' }),
    eventType: z.string().nullable().openapi({ example: 'payment' }),
    providerPaymentId: z.string().nullable().openapi({
      description: 'The provider\'s payment id (bare), when known — what the dashboard link and *match by hand* use.',
    }),
    checkoutId: z.string().nullable(),
    attempts: z.number().int().nullable().openapi({ description: 'Processing attempts of an event; `null` for a checkout row.' }),
    detail: z.string().nullable().openapi({
      description: 'The stored failure, mismatch or dispute description. Never a provider message.',
      example: 'payment not landed: the receivable is void',
    }),
    occurredAt: z.string().openapi({
      description: 'When the event was received, or the checkout last changed. The list is ordered by it, oldest first.',
      example: '2026-11-26T14:03:00.000Z',
    }),
    receivable: z
      .object({
        kind: ReceivableKindSchema,
        id: z.string(),
        userId: z.string().openapi({ description: 'The student who owes it.' }),
        studentName: z.string().nullable(),
        amountMinor: z.number().int().openapi({
          description: 'What the checkout asked for — not necessarily what the provider captured.',
          example: 15000,
        }),
        currency: z.string().openapi({ example: 'BRL' }),
      })
      .nullable()
      .openapi({ description: 'What the checkout was collecting; `null` when no checkout is known.' }),
  })
  .openapi('PaymentException');

export const PaymentExceptionListSchema = z
  .object({ exceptions: z.array(PaymentExceptionSchema).openapi({ description: 'Oldest first; dismissed rows excluded.' }) })
  .openapi('PaymentExceptionList');

/** Body of `POST /v1/admin/billing/payments/exceptions/dismiss`. */
export const DismissPaymentExceptionBodySchema = z
  .object({
    ref: z.string().min(1).max(300).openapi({ example: 'event:mercadopago:123456789' }),
    note: z.string().min(1).max(500).openapi({
      description: 'Why it is being dismissed — 1 to 500 characters, not blank.',
      example: 'Matched by hand to the November invoice.',
    }),
  })
  .strict()
  .openapi('DismissPaymentExceptionBody');

export const DismissedPaymentExceptionSchema = z
  .object({
    ref: z.string(),
    dismissedBy: z.string(),
    dismissedAt: z.string().openapi({ example: '2026-11-26T15:00:00.000Z' }),
  })
  .openapi('DismissedPaymentException');
