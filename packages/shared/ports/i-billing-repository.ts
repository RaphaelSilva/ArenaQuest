import type { Entities } from '../types/entities';

/**
 * IBillingRepository
 *
 * Cloud-agnostic persistence port for the billing context (RFC 0013 section 4).
 * The implementation lives in `apps/api/src/adapters/db/`; no database handle,
 * no worker `env`, no HTTP-framework type and no validation schema may cross
 * this boundary, so the SQLite adapter stays swappable for Postgres.
 *
 * Records here are the persistence-facing flat rows: dates and timestamps are
 * `string`s exactly as SQLite stores them (`YYYY-MM-DD` for dates), and a
 * relation is an id rather than a nested object. `Entities.Billing` holds the
 * richer canonical shapes.
 *
 * Money is always an integer count of a currency's minor unit. Two tables are
 * **append-only**: a `payments` row is corrected by a reversing row with a
 * negative amount, and an `invoice_adjustments` row is how "this student owes
 * less than the contract says" is expressed. Neither is ever updated in place,
 * which is why this port declares no `updatePayment` or `deleteAdjustment`.
 *
 * **No payment-gateway port is declared** (RFC 0013 #9). `externalReference` on
 * the payment record is the whole of the forward compatibility: a future
 * provider adapter calls the same `recordPayment` path an admin calls, with
 * `method = 'gateway'` and its charge id in that field. No gateway interface,
 * adapter or webhook shape belongs here.
 */

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface CurrencyRecord {
  code: string;
  /** Minor units per whole = 10 ** exponent. */
  exponent: number;
  symbol: string;
  name: string;
  active: boolean;
}

export interface BillingPlanRecord {
  id: string;
  name: string;
  description: string;
  amountMinor: number;
  currency: string;
  cycle: Entities.Config.BillingCycle;
  graceDays: number;
  /** Reserved; read by nothing in v1. */
  scopeTopicId: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionRecord {
  id: string;
  userId: string;
  planId: string;
  contractGroupId: string;
  supersedesId: string | null;
  termsSource: Entities.Config.ContractTermsSource;
  /** Snapshots taken from the plan at signature; never re-read from it. */
  amountMinor: number;
  currency: string;
  cycle: Entities.Config.BillingCycle;
  graceDays: number;
  dueDay: number;
  status: Entities.Config.ContractStatus;
  /** YYYY-MM-DD — this version's start. */
  startDate: string;
  endDate: string | null;
  termsNote: string;
  signedBy: string;
  signedAt: string;
  updatedAt: string;
}

export interface InvoiceRecord {
  id: string;
  subscriptionId: string;
  userId: string;
  /** YYYY-MM-DD, inclusive. */
  periodStart: string;
  /** YYYY-MM-DD, exclusive. */
  periodEnd: string;
  dueDate: string;
  amountMinor: number;
  currency: string;
  /** Snapshot; the copy `resolveStanding` reads. */
  graceDays: number;
  status: Entities.Config.InvoiceStatus;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

/**
 * An invoice carrying its computed balance,
 * `amountMinor + SUM(adjustments) - SUM(payments)`.
 *
 * Declared here because `listOpenInvoices` is what feeds `resolveStanding`:
 * returning a bare invoice row would force every caller to recompute the sum
 * the adapter is already in a position to produce in one query.
 */
export type InvoiceWithBalanceRecord = InvoiceRecord & { balanceMinor: number };

export interface InvoiceAdjustmentRecord {
  id: string;
  invoiceId: string;
  kind: Entities.Config.AdjustmentKind;
  /** Signed and never zero; negative reduces what is owed. */
  amountMinor: number;
  reason: string;
  appliedBy: string;
  appliedAt: string;
}

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  /** Signed and never zero; negative is a reversal. */
  amountMinor: number;
  currency: string;
  method: Entities.Config.PaymentMethod;
  /** When the money moved, not when it was typed in. */
  paidAt: string;
  externalReference: string | null;
  note: string;
  reversesId: string | null;
  recordedBy: string;
  recordedAt: string;
}

export interface BillingStandingHoldRecord {
  userId: string;
  reason: string;
  /** YYYY-MM-DD; null never expires. */
  expiresAt: string | null;
  setBy: string;
  setAt: string;
}

/** One row of the money history of an invoice, in `occurredAt` order. */
export type LedgerEntryRecord =
  | { entry: 'payment'; payment: PaymentRecord; occurredAt: string }
  | { entry: 'adjustment'; adjustment: InvoiceAdjustmentRecord; occurredAt: string };

// ---------------------------------------------------------------------------
// Inputs and filters
// ---------------------------------------------------------------------------

export interface BillingPlanFilter {
  /** Omitted returns every plan; `false` is the everyday catalogue view. */
  archived?: boolean;
  cycle?: Entities.Config.BillingCycle;
}

export interface CreateBillingPlanInput {
  name: string;
  description?: string;
  amountMinor: number;
  currency: string;
  cycle: Entities.Config.BillingCycle;
  graceDays: number;
  scopeTopicId?: string | null;
}

export type UpdateBillingPlanInput = Partial<
  Omit<CreateBillingPlanInput, 'currency'> & { archived: boolean }
>;

export interface SubscriptionFilter {
  userId?: string;
  planId?: string;
  status?: Entities.Config.ContractStatus;
  contractGroupId?: string;
}

export interface CreateSubscriptionInput {
  userId: string;
  planId: string;
  /** Snapshots; a value differing from the plan is a negotiated contract. */
  amountMinor: number;
  currency: string;
  cycle: Entities.Config.BillingCycle;
  graceDays: number;
  dueDay: number;
  termsSource: Entities.Config.ContractTermsSource;
  startDate: string;
  termsNote?: string;
  signedBy: string;
}

/**
 * Amending a contract never edits it: the live row moves to `superseded` with
 * its `endDate` closed, and a new `active` row carries the new terms, its
 * `supersedesId` pointing back and the reason in `termsNote`. Both rows keep
 * the same `contractGroupId`.
 */
export interface AmendSubscriptionInput {
  /** The currently active version being superseded. */
  subscriptionId: string;
  amountMinor?: number;
  cycle?: Entities.Config.BillingCycle;
  graceDays?: number;
  dueDay?: number;
  termsSource?: Entities.Config.ContractTermsSource;
  /** YYYY-MM-DD — the new version's start, and the old one's `endDate`. */
  startDate: string;
  termsNote: string;
  signedBy: string;
}

export interface InvoiceFilter {
  userId?: string;
  subscriptionId?: string;
  status?: Entities.Config.InvoiceStatus;
  /** YYYY-MM-DD, inclusive bounds on `dueDate`. */
  dueFrom?: string;
  dueTo?: string;
}

export interface CreateInvoiceInput {
  subscriptionId: string;
  userId: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  amountMinor: number;
  currency: string;
  graceDays: number;
}

/**
 * The window the invoice run bills. `UNIQUE (subscription_id, period_start)` is
 * what makes re-running it safe, so the implementation must be idempotent and
 * return only the invoices it actually created.
 */
export interface IssueInvoicesInput {
  /** YYYY-MM-DD — bill every active contract whose period contains this date. */
  referenceDate: string;
}

export interface RecordPaymentInput {
  invoiceId: string;
  /** Signed and never zero; negative is a reversal. */
  amountMinor: number;
  currency: string;
  method: Entities.Config.PaymentMethod;
  paidAt: string;
  externalReference?: string | null;
  note?: string;
  /** Set on a reversal row, naming the payment being reversed. */
  reversesId?: string | null;
  recordedBy: string;
}

export interface ApplyAdjustmentInput {
  invoiceId: string;
  kind: Entities.Config.AdjustmentKind;
  /** Signed and never zero; negative reduces what is owed. */
  amountMinor: number;
  reason: string;
  appliedBy: string;
}

export interface LedgerFilter {
  invoiceId?: string;
  userId?: string;
  /** YYYY-MM-DD, inclusive bounds on when the entry occurred. */
  from?: string;
  to?: string;
}

export interface SetHoldInput {
  userId: string;
  reason: string;
  expiresAt?: string | null;
  setBy: string;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

export interface IBillingRepository {
  // Currencies — reference data, seeded by migration and extended by SQL.
  //
  // RFC 0013 §1 and decision #13: an unknown code is rejected by the
  // *database*, and adding a currency is a `wrangler d1 execute` rather than a
  // deploy. These two readers are what let the service honour that — it asks
  // the table whether a code exists instead of consulting a hardcoded list —
  // and they are also where a report gets the `exponent` and `symbol` it
  // returns alongside every minor-unit amount.
  getCurrency(code: string): Promise<CurrencyRecord | null>;
  /** Every row, active or not; at most one is ever `active`. */
  listCurrencies(): Promise<CurrencyRecord[]>;

  // Plans — the catalogue. Freely editable; nothing here is read once a
  // subscription has copied it.
  listPlans(filter?: BillingPlanFilter): Promise<BillingPlanRecord[]>;
  getPlan(id: string): Promise<BillingPlanRecord | null>;
  createPlan(input: CreateBillingPlanInput): Promise<BillingPlanRecord>;
  updatePlan(id: string, patch: UpdateBillingPlanInput): Promise<BillingPlanRecord | null>;

  // Subscriptions — the signed contracts.
  listSubscriptions(filter?: SubscriptionFilter): Promise<SubscriptionRecord[]>;
  getSubscription(id: string): Promise<SubscriptionRecord | null>;
  /** At most one active contract per student — a partial unique index enforces it. */
  getActiveSubscription(userId: string): Promise<SubscriptionRecord | null>;
  /** Every version of one contract chain, oldest first. */
  listContractGroup(contractGroupId: string): Promise<SubscriptionRecord[]>;
  createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord>;
  updateSubscriptionStatus(
    id: string,
    status: Entities.Config.ContractStatus,
    endDate?: string | null,
  ): Promise<SubscriptionRecord | null>;
  /** Returns the new active version; the superseded one keeps its own row. */
  amendSubscription(input: AmendSubscriptionInput): Promise<SubscriptionRecord>;

  // Invoices.
  /** Carries each invoice's balance, because this is what feeds `resolveStanding`. */
  listOpenInvoices(userId: string): Promise<InvoiceWithBalanceRecord[]>;
  listInvoices(filter: InvoiceFilter): Promise<InvoiceWithBalanceRecord[]>;
  getInvoice(id: string): Promise<InvoiceWithBalanceRecord | null>;
  /** Idempotent: returns only the invoices this run actually created. */
  issueInvoices(period: IssueInvoicesInput): Promise<InvoiceRecord[]>;
  createInvoice(input: CreateInvoiceInput): Promise<InvoiceRecord>;
  voidInvoice(id: string, reason: string, voidedBy: string): Promise<InvoiceRecord | null>;

  // Ledger — append-only on both tables.
  recordPayment(input: RecordPaymentInput): Promise<PaymentRecord>;
  getPayment(id: string): Promise<PaymentRecord | null>;
  applyAdjustment(input: ApplyAdjustmentInput): Promise<InvoiceAdjustmentRecord>;
  listLedger(filter: LedgerFilter): Promise<LedgerEntryRecord[]>;

  // Holds — "stop chasing this one". Suppresses a report and an email; it
  // grants nothing and revokes nothing.
  getHold(userId: string): Promise<BillingStandingHoldRecord | null>;
  listHolds(): Promise<BillingStandingHoldRecord[]>;
  setHold(input: SetHoldInput): Promise<BillingStandingHoldRecord>;
  clearHold(userId: string): Promise<void>;
}
