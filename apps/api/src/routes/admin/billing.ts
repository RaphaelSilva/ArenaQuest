import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { requireRole } from '@api/middleware/require-role';
import { ROLES } from '@arenaquest/shared/constants/roles';
import { AdminBillingController } from '@api/controllers/admin-billing.controller';
import { respondWith, respondCreated } from '@api/routes/_shared/envelope';
import type { AppContainer } from '@api/container';

/**
 * `/v1/admin/billing` — the admin lifecycle surface (RFC 0013 §5).
 *
 * HTTP only: parse, guard, shape. Every rule lives in `BillingService` and
 * every branch arrives as a `ControllerResult`.
 *
 * **Money is an integer count of the currency's minor unit**, in every request
 * and every response. Nothing here formats: a response carries the amount and
 * the currency code, and the exponent and symbol come from `currencies`.
 */

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const IsoDate = z.string().openapi({ example: '2026-01-01' });
const MinorUnits = z.number().int().openapi({ example: 15000 });

const CycleSchema = z.enum(['monthly', 'quarterly', 'yearly']).openapi({ example: 'monthly' });
const TermsSourceSchema = z.enum(['standard', 'negotiated']).openapi({ example: 'standard' });
const ContractStatusSchema = z.enum(['active', 'paused', 'cancelled', 'superseded']);
const InvoiceStatusSchema = z.enum(['open', 'paid', 'void']);
const AdjustmentKindSchema = z.enum(['discount', 'credit', 'waiver', 'surcharge']);
const PaymentMethodSchema = z.enum(['cash', 'pix', 'bank_transfer', 'card', 'gateway', 'other']);

const PlanSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    amountMinor: MinorUnits,
    currency: z.string().openapi({ example: 'BRL' }),
    cycle: CycleSchema,
    graceDays: z.number().int(),
    scopeTopicId: z.string().nullable(),
    archived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('BillingPlan');

const SubscriptionSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    planId: z.string(),
    contractGroupId: z.string(),
    supersedesId: z.string().nullable(),
    termsSource: TermsSourceSchema,
    amountMinor: MinorUnits,
    currency: z.string(),
    cycle: CycleSchema,
    graceDays: z.number().int(),
    dueDay: z.number().int(),
    status: ContractStatusSchema,
    startDate: IsoDate,
    endDate: IsoDate.nullable(),
    termsNote: z.string(),
    signedBy: z.string(),
    signedAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('BillingSubscription');

const InvoiceSchema = z
  .object({
    id: z.string(),
    subscriptionId: z.string(),
    userId: z.string(),
    periodStart: IsoDate,
    periodEnd: IsoDate,
    dueDate: IsoDate,
    amountMinor: MinorUnits,
    currency: z.string(),
    graceDays: z.number().int(),
    status: InvoiceStatusSchema,
    issuedAt: z.string(),
    voidedAt: z.string().nullable(),
    voidReason: z.string().nullable(),
  })
  .openapi('BillingInvoice');

const InvoiceWithBalanceSchema = InvoiceSchema.extend({
  balanceMinor: MinorUnits,
}).openapi('BillingInvoiceWithBalance');

const AdjustmentSchema = z
  .object({
    id: z.string(),
    invoiceId: z.string(),
    kind: AdjustmentKindSchema,
    amountMinor: MinorUnits,
    reason: z.string(),
    appliedBy: z.string(),
    appliedAt: z.string(),
  })
  .openapi('BillingInvoiceAdjustment');

const PaymentSchema = z
  .object({
    id: z.string(),
    invoiceId: z.string(),
    amountMinor: MinorUnits,
    currency: z.string(),
    method: PaymentMethodSchema,
    paidAt: z.string(),
    externalReference: z.string().nullable(),
    note: z.string(),
    reversesId: z.string().nullable(),
    recordedBy: z.string(),
    recordedAt: z.string(),
  })
  .openapi('BillingPayment');

const IdParamSchema = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'plan-id' }),
});

const json = <S extends z.ZodTypeAny>(description: string, schema: S) => ({
  description,
  content: { 'application/json': { schema } },
});

const ERROR_RESPONSES = {
  400: { description: 'Validation failed' },
  403: { description: 'Forbidden — admin only' },
  404: { description: 'Not found' },
  409: { description: 'Conflict' },
};

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

const body = <S extends z.ZodTypeAny>(schema: S) => ({
  body: { content: { 'application/json': { schema } } },
});

const CreatePlanBodySchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    amountMinor: MinorUnits.min(0),
    currency: z.string().openapi({ example: 'BRL' }),
    cycle: CycleSchema,
    graceDays: z.number().int().min(0).openapi({ example: 5 }),
    scopeTopicId: z.string().nullable().optional(),
  })
  .openapi('CreateBillingPlanBody');

const UpdatePlanBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    amountMinor: MinorUnits.min(0).optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().min(0).optional(),
    scopeTopicId: z.string().nullable().optional(),
    archived: z.boolean().optional(),
  })
  .openapi('UpdateBillingPlanBody');

const SignContractBodySchema = z
  .object({
    userId: z.string().min(1),
    planId: z.string().min(1),
    dueDay: z.number().int().min(1).max(28).openapi({ example: 10 }),
    startDate: IsoDate,
    termsSource: TermsSourceSchema.optional(),
    amountMinor: MinorUnits.min(0).optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().min(0).optional(),
    termsNote: z.string().optional(),
  })
  .openapi('SignContractBody');

const ChangeLifecycleBodySchema = z
  .object({
    action: z.enum(['pause', 'resume', 'cancel']).openapi({ example: 'pause' }),
    endDate: IsoDate.optional(),
    // Declared so the refusal can name `/amend` rather than reading as an
    // unrecognised field; the service rejects every one of them.
    amountMinor: MinorUnits.optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().optional(),
    dueDay: z.number().int().optional(),
  })
  .openapi('ChangeContractLifecycleBody');

const AmendContractBodySchema = z
  .object({
    startDate: IsoDate,
    termsNote: z.string().min(1).openapi({ example: 'Scholarship agreed for 2026.' }),
    amountMinor: MinorUnits.min(0).optional(),
    cycle: CycleSchema.optional(),
    graceDays: z.number().int().min(0).optional(),
    dueDay: z.number().int().min(1).max(28).optional(),
    termsSource: TermsSourceSchema.optional(),
  })
  .openapi('AmendContractBody');

const IssueInvoiceBodySchema = z
  .object({
    subscriptionId: z.string().min(1),
    periodStart: IsoDate.optional(),
    periodEnd: IsoDate.optional(),
    dueDate: IsoDate.optional(),
    amountMinor: MinorUnits.min(0).optional(),
    referenceDate: IsoDate.optional(),
  })
  .openapi('IssueInvoiceBody');

const VoidInvoiceBodySchema = z
  .object({ reason: z.string().openapi({ example: 'Issued to the wrong student.' }) })
  .openapi('VoidInvoiceBody');

const ApplyAdjustmentBodySchema = z
  .object({
    kind: AdjustmentKindSchema,
    /** Signed and never zero; negative reduces what is owed. */
    amountMinor: MinorUnits.openapi({ example: -5000 }),
    reason: z.string(),
  })
  .openapi('ApplyAdjustmentBody');

const RecordPaymentBodySchema = z
  .object({
    amountMinor: MinorUnits,
    method: PaymentMethodSchema,
    paidAt: IsoDate.optional(),
    currency: z.string().optional(),
    externalReference: z.string().nullable().optional(),
    note: z.string().optional(),
  })
  .openapi('RecordPaymentBody');

const ReversePaymentBodySchema = z
  .object({
    reason: z.string().openapi({ example: 'Cheque bounced.' }),
    paidAt: IsoDate.optional(),
  })
  .openapi('ReversePaymentBody');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const common = { tags: ['admin:billing'], security: [{ bearerAuth: [] }] };

export const listPlansRoute = createRoute({
  ...common,
  method: 'get',
  path: '/plans',
  summary: 'List Billing Plans',
  description: 'The price list. Freely editable — a signed contract snapshots its terms.',
  request: {
    query: z.object({
      archived: z.enum(['true', 'false']).optional(),
      cycle: CycleSchema.optional(),
    }),
  },
  responses: { 200: json('Plans', z.array(PlanSchema)), ...ERROR_RESPONSES },
});

export const createPlanRoute = createRoute({
  ...common,
  method: 'post',
  path: '/plans',
  summary: 'Create a Billing Plan',
  request: body(CreatePlanBodySchema),
  responses: { 201: json('Plan created', PlanSchema), ...ERROR_RESPONSES },
});

export const updatePlanRoute = createRoute({
  ...common,
  method: 'patch',
  path: '/plans/{id}',
  summary: 'Edit a Billing Plan',
  description:
    'Editing the shelf is safe: every signed contract and every issued invoice carries its own snapshot of the terms.',
  request: { params: IdParamSchema, ...body(UpdatePlanBodySchema) },
  responses: { 200: json('Plan updated', PlanSchema), ...ERROR_RESPONSES },
});

export const listSubscriptionsRoute = createRoute({
  ...common,
  method: 'get',
  path: '/subscriptions',
  summary: 'List Contracts',
  request: {
    query: z.object({
      userId: z.string().optional(),
      planId: z.string().optional(),
      status: ContractStatusSchema.optional(),
      contractGroupId: z.string().optional(),
    }),
  },
  responses: { 200: json('Contracts', z.array(SubscriptionSchema)), ...ERROR_RESPONSES },
});

export const signContractRoute = createRoute({
  ...common,
  method: 'post',
  path: '/subscriptions',
  summary: 'Sign a Contract',
  description:
    "Snapshots the plan's amount, currency, cycle and grace days onto the contract. Negotiated terms require termsSource 'negotiated' and a termsNote.",
  request: body(SignContractBodySchema),
  responses: { 201: json('Contract signed', SubscriptionSchema), ...ERROR_RESPONSES },
});

export const changeLifecycleRoute = createRoute({
  ...common,
  method: 'patch',
  path: '/subscriptions/{id}',
  summary: 'Change a Contract Lifecycle',
  description: 'Pause, resume or cancel only. Terms move through POST /subscriptions/{id}/amend.',
  request: { params: IdParamSchema, ...body(ChangeLifecycleBodySchema) },
  responses: { 200: json('Contract updated', SubscriptionSchema), ...ERROR_RESPONSES },
});

export const amendContractRoute = createRoute({
  ...common,
  method: 'post',
  path: '/subscriptions/{id}/amend',
  summary: 'Amend a Contract',
  description:
    'Closes the live version to superseded and opens a new active one in the same contract group.',
  request: { params: IdParamSchema, ...body(AmendContractBodySchema) },
  responses: { 201: json('Contract amended', SubscriptionSchema), ...ERROR_RESPONSES },
});

export const listInvoicesRoute = createRoute({
  ...common,
  method: 'get',
  path: '/invoices',
  summary: 'Search Invoices',
  request: {
    query: z.object({
      status: InvoiceStatusSchema.optional(),
      from: IsoDate.optional(),
      to: IsoDate.optional(),
      userId: z.string().optional(),
      subscriptionId: z.string().optional(),
    }),
  },
  responses: {
    200: json('Invoices with their balances', z.array(InvoiceWithBalanceSchema)),
    ...ERROR_RESPONSES,
  },
});

export const issueInvoiceRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices',
  summary: 'Issue an Ad-hoc Invoice',
  description: "Snapshots the contract's terms — never the plan's. A zero amount settles at issue.",
  request: body(IssueInvoiceBodySchema),
  responses: { 201: json('Invoice issued', InvoiceSchema), ...ERROR_RESPONSES },
});

export const voidInvoiceRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices/{id}/void',
  summary: 'Void an Invoice',
  description: 'The reason is mandatory. The acting admin is recorded in the audit event.',
  request: { params: IdParamSchema, ...body(VoidInvoiceBodySchema) },
  responses: { 200: json('Invoice voided', InvoiceSchema), ...ERROR_RESPONSES },
});

export const applyAdjustmentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices/{id}/adjustments',
  summary: 'Apply an Invoice Adjustment',
  description: 'Append-only. Negative reduces what is owed; nothing accrues a fee on its own.',
  request: { params: IdParamSchema, ...body(ApplyAdjustmentBodySchema) },
  responses: { 201: json('Adjustment applied', AdjustmentSchema), ...ERROR_RESPONSES },
});

export const recordPaymentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/invoices/{id}/payments',
  summary: 'Record a Payment',
  request: { params: IdParamSchema, ...body(RecordPaymentBodySchema) },
  responses: { 201: json('Payment recorded', PaymentSchema), ...ERROR_RESPONSES },
});

export const reversePaymentRoute = createRoute({
  ...common,
  method: 'post',
  path: '/payments/{id}/reverse',
  summary: 'Reverse a Payment',
  description: 'Appends the mirror-image row; the original is never updated or deleted.',
  request: { params: IdParamSchema, ...body(ReversePaymentBodySchema) },
  responses: { 201: json('Reversal recorded', PaymentSchema), ...ERROR_RESPONSES },
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function buildAdminBillingRouter(container: AppContainer) {
  const controller = new AdminBillingController(container.billing.billingService);

  const router = new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: 'ValidationError' as const, issues: result.error.issues }, 400);
      }
    },
  });

  // The dojo's finances are ADMIN-only, stricter than the admin umbrella
  // (`/v1/admin/*` admits ADMIN and CONTENT_CREATOR). Mounting billing without
  // this guard would hand every content creator the money. A tutor is
  // deliberately given nothing here (RFC 0013 §5).
  router.use('*', requireRole(ROLES.ADMIN));

  router.openapi(listPlansRoute, async (c) => {
    const q = c.req.valid('query');
    const result = await controller.listPlans({
      archived: q.archived === undefined ? undefined : q.archived === 'true',
      cycle: q.cycle,
    });
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(createPlanRoute, async (c) => {
    const result = await controller.createPlan(c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(updatePlanRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.updatePlan(id, c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(listSubscriptionsRoute, async (c) => {
    const result = await controller.listSubscriptions(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(signContractRoute, async (c) => {
    const result = await controller.signContract(c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(changeLifecycleRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.changeLifecycle(id, c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(amendContractRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.amendContract(id, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(listInvoicesRoute, async (c) => {
    const result = await controller.listInvoices(c.req.valid('query'));
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(issueInvoiceRoute, async (c) => {
    const result = await controller.issueInvoice(c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(voidInvoiceRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.voidInvoice(id, c.req.valid('json'), c.get('user').sub);
    if (!result.ok) return respondWith(c, result);
    return c.json(result.data, 200);
  });

  router.openapi(applyAdjustmentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.applyAdjustment(id, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(recordPaymentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.recordPayment(id, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  router.openapi(reversePaymentRoute, async (c) => {
    const { id } = c.req.valid('param');
    const result = await controller.reversePayment(id, c.req.valid('json'), c.get('user').sub);
    return respondCreated(c, result);
  });

  return router;
}
