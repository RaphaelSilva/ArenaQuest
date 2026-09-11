import type {
  IBillingRepository,
  CurrencyRecord,
  BillingPlanRecord,
  BillingPlanFilter,
  CreateBillingPlanInput,
  UpdateBillingPlanInput,
  SubscriptionRecord,
  SubscriptionFilter,
  CreateSubscriptionInput,
  AmendSubscriptionInput,
  InvoiceRecord,
  InvoiceWithBalanceRecord,
  InvoiceFilter,
  CreateInvoiceInput,
  IssueInvoicesInput,
  InvoiceAdjustmentRecord,
  ApplyAdjustmentInput,
  PaymentRecord,
  RecordPaymentInput,
  LedgerEntryRecord,
  LedgerFilter,
  BillingStandingHoldRecord,
  SetHoldInput,
} from '@arenaquest/shared/ports';
import { Entities } from '@arenaquest/shared/types/entities';

/**
 * An in-memory `IBillingRepository` for the node-pool specs.
 *
 * It reproduces the two behaviours of the D1 adapter that the service's rules
 * actually rest on — the balance is always recomputed from the signed ledger
 * rows, and `status` is a cache of "the balance reached zero" — and nothing
 * else. It is deliberately *not* a second implementation: constraint
 * enforcement stays in `test/db/`, against real SQLite.
 */

const { ContractStatus, InvoiceStatus } = Entities.Config;

let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${++counter}`;

/** Migration 0026's seed rows, so the fake starts where a migrated D1 does. */
const SEEDED_CURRENCIES: CurrencyRecord[] = [
  { code: 'BRL', exponent: 2, symbol: 'R$', name: 'Brazilian real', active: true },
  { code: 'USD', exponent: 2, symbol: 'US$', name: 'US dollar', active: false },
  { code: 'EUR', exponent: 2, symbol: '\u20ac', name: 'Euro', active: false },
  { code: 'JPY', exponent: 0, symbol: '\u00a5', name: 'Japanese yen', active: false },
  { code: 'BTC', exponent: 8, symbol: '\u20bf', name: 'Bitcoin', active: false },
];

/** Normalises `YYYY-MM-DD` and `YYYY-MM-DD HH:MM:SS` to a comparable day. */
const dayOf = (timestamp: string): string => timestamp.slice(0, 10);

export class FakeBillingRepository implements IBillingRepository {
  /**
   * Seeded exactly as migration 0026 seeds the table, and writable by a spec:
   * "a currency added at runtime is accepted" is a rule the service now enforces
   * by reading this map rather than a constant.
   */
  readonly currencies = new Map<string, CurrencyRecord>(
    SEEDED_CURRENCIES.map((currency) => [currency.code, { ...currency }]),
  );
  readonly plans = new Map<string, BillingPlanRecord>();
  readonly subscriptions = new Map<string, SubscriptionRecord>();
  readonly invoices = new Map<string, InvoiceRecord>();
  readonly adjustments: InvoiceAdjustmentRecord[] = [];
  readonly payments: PaymentRecord[] = [];
  readonly holds = new Map<string, BillingStandingHoldRecord>();

  // Currencies --------------------------------------------------------------

  async getCurrency(code: string): Promise<CurrencyRecord | null> {
    return this.currencies.get(code) ?? null;
  }

  async listCurrencies(): Promise<CurrencyRecord[]> {
    return [...this.currencies.values()].sort(
      (a, b) => Number(b.active) - Number(a.active) || a.code.localeCompare(b.code),
    );
  }

  // Plans -------------------------------------------------------------------

  async listPlans(filter: BillingPlanFilter = {}): Promise<BillingPlanRecord[]> {
    return [...this.plans.values()].filter(
      (p) =>
        (filter.archived === undefined || p.archived === filter.archived) &&
        (filter.cycle === undefined || p.cycle === filter.cycle),
    );
  }

  async getPlan(id: string): Promise<BillingPlanRecord | null> {
    return this.plans.get(id) ?? null;
  }

  async createPlan(input: CreateBillingPlanInput): Promise<BillingPlanRecord> {
    const plan: BillingPlanRecord = {
      id: nextId('plan'),
      name: input.name,
      description: input.description ?? '',
      amountMinor: input.amountMinor,
      currency: input.currency,
      cycle: input.cycle,
      graceDays: input.graceDays,
      scopeTopicId: input.scopeTopicId ?? null,
      archived: false,
      createdAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    };
    this.plans.set(plan.id, plan);
    return plan;
  }

  async updatePlan(id: string, patch: UpdateBillingPlanInput): Promise<BillingPlanRecord | null> {
    const plan = this.plans.get(id);
    if (!plan) return null;
    const updated: BillingPlanRecord = { ...plan };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (updated as Record<string, unknown>)[key] = value;
    }
    this.plans.set(id, updated);
    return updated;
  }

  // Subscriptions -----------------------------------------------------------

  async listSubscriptions(filter: SubscriptionFilter = {}): Promise<SubscriptionRecord[]> {
    return [...this.subscriptions.values()].filter(
      (s) =>
        (filter.userId === undefined || s.userId === filter.userId) &&
        (filter.planId === undefined || s.planId === filter.planId) &&
        (filter.status === undefined || s.status === filter.status) &&
        (filter.contractGroupId === undefined || s.contractGroupId === filter.contractGroupId),
    );
  }

  async getSubscription(id: string): Promise<SubscriptionRecord | null> {
    return this.subscriptions.get(id) ?? null;
  }

  async getActiveSubscription(userId: string): Promise<SubscriptionRecord | null> {
    return (
      [...this.subscriptions.values()].find(
        (s) => s.userId === userId && s.status === ContractStatus.ACTIVE,
      ) ?? null
    );
  }

  async listContractGroup(contractGroupId: string): Promise<SubscriptionRecord[]> {
    return [...this.subscriptions.values()].filter((s) => s.contractGroupId === contractGroupId);
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<SubscriptionRecord> {
    const id = nextId('sub');
    const subscription: SubscriptionRecord = {
      id,
      userId: input.userId,
      planId: input.planId,
      // The first version of a chain is its own group.
      contractGroupId: id,
      supersedesId: null,
      termsSource: input.termsSource,
      amountMinor: input.amountMinor,
      currency: input.currency,
      cycle: input.cycle,
      graceDays: input.graceDays,
      dueDay: input.dueDay,
      status: ContractStatus.ACTIVE,
      startDate: input.startDate,
      endDate: null,
      termsNote: input.termsNote ?? '',
      signedBy: input.signedBy,
      signedAt: '2026-01-01 00:00:00',
      updatedAt: '2026-01-01 00:00:00',
    };
    this.subscriptions.set(id, subscription);
    return subscription;
  }

  async updateSubscriptionStatus(
    id: string,
    status: Entities.Config.ContractStatus,
    endDate?: string | null,
  ): Promise<SubscriptionRecord | null> {
    const current = this.subscriptions.get(id);
    if (!current) return null;
    const updated: SubscriptionRecord = {
      ...current,
      status,
      endDate: endDate === undefined ? current.endDate : endDate,
    };
    this.subscriptions.set(id, updated);
    return updated;
  }

  async amendSubscription(input: AmendSubscriptionInput): Promise<SubscriptionRecord> {
    const current = this.subscriptions.get(input.subscriptionId);
    if (!current) throw new Error(`unknown subscription ${input.subscriptionId}`);

    this.subscriptions.set(current.id, {
      ...current,
      status: ContractStatus.SUPERSEDED,
      endDate: input.startDate,
    });

    const id = nextId('sub');
    const amended: SubscriptionRecord = {
      ...current,
      id,
      supersedesId: current.id,
      termsSource: input.termsSource ?? current.termsSource,
      amountMinor: input.amountMinor ?? current.amountMinor,
      // Currency is not amendable.
      currency: current.currency,
      cycle: input.cycle ?? current.cycle,
      graceDays: input.graceDays ?? current.graceDays,
      dueDay: input.dueDay ?? current.dueDay,
      status: ContractStatus.ACTIVE,
      startDate: input.startDate,
      endDate: null,
      termsNote: input.termsNote,
      signedBy: input.signedBy,
    };
    this.subscriptions.set(id, amended);
    return amended;
  }

  // Invoices ----------------------------------------------------------------

  private balanceOf(invoice: InvoiceRecord): number {
    const adjustments = this.adjustments
      .filter((a) => a.invoiceId === invoice.id)
      .reduce((sum, a) => sum + a.amountMinor, 0);
    const payments = this.payments
      .filter((p) => p.invoiceId === invoice.id)
      .reduce((sum, p) => sum + p.amountMinor, 0);
    return invoice.amountMinor + adjustments - payments;
  }

  /** `status` is a cache of the balance, exactly as the adapter treats it. */
  private refresh(invoiceId: string): void {
    const invoice = this.invoices.get(invoiceId);
    if (!invoice || invoice.status === InvoiceStatus.VOID) return;
    const status = this.balanceOf(invoice) <= 0 ? InvoiceStatus.PAID : InvoiceStatus.OPEN;
    this.invoices.set(invoiceId, { ...invoice, status });
  }

  private withBalance(invoice: InvoiceRecord): InvoiceWithBalanceRecord {
    return { ...invoice, balanceMinor: this.balanceOf(invoice) };
  }

  async listOpenInvoices(userId: string): Promise<InvoiceWithBalanceRecord[]> {
    return [...this.invoices.values()]
      .filter((i) => i.userId === userId && i.status === InvoiceStatus.OPEN)
      .map((i) => this.withBalance(i));
  }

  async listInvoices(filter: InvoiceFilter): Promise<InvoiceWithBalanceRecord[]> {
    return [...this.invoices.values()]
      .filter(
        (i) =>
          (filter.userId === undefined || i.userId === filter.userId) &&
          (filter.subscriptionId === undefined || i.subscriptionId === filter.subscriptionId) &&
          (filter.status === undefined || i.status === filter.status) &&
          (filter.dueFrom === undefined || i.dueDate >= filter.dueFrom) &&
          (filter.dueTo === undefined || i.dueDate <= filter.dueTo),
      )
      .map((i) => this.withBalance(i));
  }

  async getInvoice(id: string): Promise<InvoiceWithBalanceRecord | null> {
    const invoice = this.invoices.get(id);
    return invoice ? this.withBalance(invoice) : null;
  }

  async issueInvoices(_period: IssueInvoicesInput): Promise<InvoiceRecord[]> {
    throw new Error('not used by Task 03');
  }

  async createInvoice(input: CreateInvoiceInput): Promise<InvoiceRecord> {
    const invoice: InvoiceRecord = {
      id: nextId('inv'),
      subscriptionId: input.subscriptionId,
      userId: input.userId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      dueDate: input.dueDate,
      amountMinor: input.amountMinor,
      currency: input.currency,
      graceDays: input.graceDays,
      status: InvoiceStatus.OPEN,
      issuedAt: '2026-01-01 00:00:00',
      voidedAt: null,
      voidReason: null,
    };
    this.invoices.set(invoice.id, invoice);
    // Settles a zero-amount invoice at issue, like the adapter's batch does.
    this.refresh(invoice.id);
    return this.invoices.get(invoice.id)!;
  }

  async voidInvoice(id: string, reason: string, _voidedBy: string): Promise<InvoiceRecord | null> {
    const invoice = this.invoices.get(id);
    if (!invoice) return null;
    const voided: InvoiceRecord = {
      ...invoice,
      status: InvoiceStatus.VOID,
      voidedAt: '2026-02-01 00:00:00',
      voidReason: reason,
    };
    this.invoices.set(id, voided);
    return voided;
  }

  // Ledger ------------------------------------------------------------------

  async recordPayment(input: RecordPaymentInput): Promise<PaymentRecord> {
    const payment: PaymentRecord = {
      id: nextId('pay'),
      invoiceId: input.invoiceId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      method: input.method,
      paidAt: input.paidAt,
      externalReference: input.externalReference ?? null,
      note: input.note ?? '',
      reversesId: input.reversesId ?? null,
      recordedBy: input.recordedBy,
      recordedAt: '2026-02-01 00:00:00',
    };
    this.payments.push(payment);
    this.refresh(input.invoiceId);
    return payment;
  }

  async getPayment(id: string): Promise<PaymentRecord | null> {
    return this.payments.find((p) => p.id === id) ?? null;
  }

  async applyAdjustment(input: ApplyAdjustmentInput): Promise<InvoiceAdjustmentRecord> {
    const adjustment: InvoiceAdjustmentRecord = {
      id: nextId('adj'),
      invoiceId: input.invoiceId,
      kind: input.kind,
      amountMinor: input.amountMinor,
      reason: input.reason,
      appliedBy: input.appliedBy,
      appliedAt: '2026-02-01 00:00:00',
    };
    this.adjustments.push(adjustment);
    this.refresh(input.invoiceId);
    return adjustment;
  }

  /**
   * Mirrors the adapter's filtering, including the detail that matters to the
   * reports: a payment is windowed on `paid_at` and an adjustment on
   * `applied_at`, and both bounds are inclusive whole days.
   */
  async listLedger(filter: LedgerFilter): Promise<LedgerEntryRecord[]> {
    const matches = (invoiceId: string, occurredAt: string): boolean => {
      if (filter.invoiceId !== undefined && invoiceId !== filter.invoiceId) return false;
      if (filter.userId !== undefined && this.invoices.get(invoiceId)?.userId !== filter.userId) {
        return false;
      }
      if (filter.from !== undefined && dayOf(occurredAt) < dayOf(filter.from)) return false;
      if (filter.to !== undefined && dayOf(occurredAt) > dayOf(filter.to)) return false;
      return true;
    };

    const entries: LedgerEntryRecord[] = [
      ...this.payments
        .filter((p) => matches(p.invoiceId, p.paidAt))
        .map((payment) => ({ entry: 'payment' as const, payment, occurredAt: payment.paidAt })),
      ...this.adjustments
        .filter((a) => matches(a.invoiceId, a.appliedAt))
        .map((adjustment) => ({
          entry: 'adjustment' as const,
          adjustment,
          occurredAt: adjustment.appliedAt,
        })),
    ];
    return entries.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  }

  // Holds -------------------------------------------------------------------

  async getHold(userId: string): Promise<BillingStandingHoldRecord | null> {
    return this.holds.get(userId) ?? null;
  }

  async listHolds(): Promise<BillingStandingHoldRecord[]> {
    return [...this.holds.values()];
  }

  async setHold(input: SetHoldInput): Promise<BillingStandingHoldRecord> {
    const hold: BillingStandingHoldRecord = {
      userId: input.userId,
      reason: input.reason,
      expiresAt: input.expiresAt ?? null,
      setBy: input.setBy,
      setAt: '2026-02-01 00:00:00',
    };
    this.holds.set(input.userId, hold);
    return hold;
  }

  async clearHold(userId: string): Promise<void> {
    this.holds.delete(userId);
  }
}
