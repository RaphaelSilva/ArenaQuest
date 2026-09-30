/**
 * extensions.mjs — the demo beyond the baseline (RFC 0021 §3.5, OQ2): events,
 * billing, tasks and comments, as rows.
 *
 * Pure: dataset + ctx in, `{ <table>: row[] }` out. No SQL text, no I/O, no
 * clock — every date is relative to `ctx.now`, so the same dataset and ctx
 * always yield the same rows. `sql.mjs` turns the rows into statements (its
 * `eventsSection`, `billingSection`, `tasksSection`, `commentsSection`) with
 * the write policy of each table; that split keeps this module free of an
 * import cycle with `sql.mjs`, as `media.mjs` and `gamification.mjs` are.
 *
 * Ids: `ctx.id(entity, key)` with the entities `event`, `billing-plan`,
 * `subscription`, `invoice`, `payment`, `task`, `task-stage` (key
 * `<task>/<stage>`) and `comment`. Join rows carry no id.
 *
 * Dates (all UTC, computed at run time from `ctx.now`):
 *   events     `YYYY-MM-DD HH:MM:SS` — `startsInDays` whole days from today at
 *              `startHourUtc`, lasting `durationHours` (null: open-ended). The
 *              board's "past" is `COALESCE(ends_at, starts_at + 1 day) < now`,
 *              and the dataset rules (dataset.mjs) keep each event on its side
 *              of that predicate whatever the hour of the run.
 *   billing    monthly contracts anchored on the 1st of a month
 *              (`startMonthsAgo`), so the rows match `computePeriod` of
 *              packages/shared/domain/billing/billing-cycle.ts: an invoice's
 *              period is [1st of month m, 1st of month m+1) and its due date is
 *              `dueDay` of month m. `paid_at` is a `YYYY-MM-DD`, as the API
 *              records it.
 *   comments   `postedDaysAgo` / `likedDaysAgo` whole days before `ctx.now`.
 *
 * Stage check-ins and comment actions are NOT seeded as progress or XP: the
 * tester performs them, so Task 06's gamification state is unchanged.
 */

import { sqliteDateTime, utcDate } from './gamification.mjs';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

// ════════════════════════════════════════════════════════════════════════════
// Dates
// ════════════════════════════════════════════════════════════════════════════

function requireNow(ctx) {
  if (!(ctx.now instanceof Date) || Number.isNaN(ctx.now.getTime())) {
    throw new TypeError('extensions: ctx.now (a valid Date) is required — event, billing and comment dates are relative to it');
  }
  return ctx.now;
}

/** `{ starts_at, ends_at }` of `event` for a run at `now`. */
export function eventTimes(event, now) {
  const starts = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + event.startsInDays, event.startHourUtc));
  const ends = event.durationHours == null ? null : new Date(starts.getTime() + event.durationHours * HOUR_MS);
  return { starts_at: sqliteDateTime(starts), ends_at: ends === null ? null : sqliteDateTime(ends) };
}

const parseSqlite = (value) => new Date(`${value.replace(' ', 'T')}Z`);

/** The board's predicate, `COALESCE(ends_at, datetime(starts_at, '+1 day')) < now`, on an `events` row. */
export function isPastEvent(row, now) {
  const end = row.ends_at === null ? new Date(parseSqlite(row.starts_at).getTime() + DAY_MS) : parseSqlite(row.ends_at);
  return end.getTime() < now.getTime();
}

/** `YYYY-MM-DD` of the 1st of the month `monthsAgo` months before `now`'s month (negative: ahead). */
export function monthStart(now, monthsAgo) {
  return utcDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)));
}

/** `YYYY-MM-DD` plus `days` whole days. */
function addDays(date, days) {
  return utcDate(new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS));
}

/**
 * The monthly period `monthsAgo` months back for a contract anchored on the
 * 1st: `{ periodStart, periodEnd, dueDate }`, as `computePeriod` computes it.
 */
export function monthlyPeriod(now, monthsAgo, dueDay) {
  const periodStart = monthStart(now, monthsAgo);
  return {
    periodStart,
    periodEnd: monthStart(now, monthsAgo - 1),
    dueDate: `${periodStart.slice(0, 8)}${String(dueDay).padStart(2, '0')}`,
  };
}

const daysBefore = (now, days) => sqliteDateTime(new Date(now.getTime() - days * DAY_MS));

// ════════════════════════════════════════════════════════════════════════════
// Rows
// ════════════════════════════════════════════════════════════════════════════

/**
 * One published event per dataset entry, `flyer_status = 'none'` (a SQL seed
 * cannot put an object in R2, and "no flyer" is a state the board renders),
 * and the group grants of the restricted ones. `content` goes through the
 * shared `sanitizeMarkdown`, as the API stores it.
 */
export function eventRows(dataset, ctx) {
  const now = requireNow(ctx);
  const sanitize = ctx.sanitizeMarkdown;
  if (typeof sanitize !== 'function') throw new TypeError('extensions: ctx.sanitizeMarkdown is required for event content');
  const events = [];
  const event_audience_group = [];
  for (const event of dataset.events ?? []) {
    const id = ctx.id('event', event.key);
    events.push({
      id,
      slug: event.slug,
      title: event.title,
      summary: event.summary ?? '',
      content: sanitize(event.content ?? ''),
      location: event.location ?? '',
      ...eventTimes(event, now),
      timezone: event.timezone ?? 'America/Sao_Paulo',
      status: 'published',
      audience: event.audience,
      flyer_status: 'none',
      whatsapp_number: '',
      whatsapp_message: null,
      contact_label: '',
      created_by: ctx.id('user', event.createdBy),
    });
    for (const group of event.groups ?? []) event_audience_group.push({ event_id: id, group_id: ctx.id('group', group) });
  }
  return { events, event_audience_group };
}

/**
 * Plans, contracts (terms SNAPSHOT from the plan, `contract_group_id` = own
 * id, signed by the dataset's admin), their invoices and the payment of each
 * paid invoice — in the dataset's currency, amounts in minor units.
 */
export function billingRows(dataset, ctx) {
  const now = requireNow(ctx);
  const billing = dataset.billing ?? { plans: [], subscriptions: [], invoices: [] };
  const signedBy = ctx.id('user', billing.signedBy);
  const plans = new Map(billing.plans.map((plan) => [plan.key, plan]));
  const contracts = new Map();

  const billing_plans = billing.plans.map((plan) => ({
    id: ctx.id('billing-plan', plan.key),
    name: plan.name,
    description: plan.description ?? '',
    amount_minor: plan.amountMinor,
    currency: billing.currency,
    cycle: plan.cycle,
    grace_days: plan.graceDays,
    archived: 0,
  }));

  const subscriptions = billing.subscriptions.map((subscription) => {
    const plan = plans.get(subscription.plan);
    const id = ctx.id('subscription', subscription.key);
    const startDate = monthStart(now, subscription.startMonthsAgo);
    const row = {
      id,
      user_id: ctx.id('user', subscription.user),
      plan_id: ctx.id('billing-plan', plan.key),
      contract_group_id: id,
      supersedes_id: null,
      terms_source: 'standard',
      amount_minor: plan.amountMinor,
      currency: billing.currency,
      cycle: plan.cycle,
      grace_days: plan.graceDays,
      due_day: subscription.dueDay,
      status: 'active',
      start_date: startDate,
      end_date: null,
      terms_note: '',
      signed_by: signedBy,
      signed_at: `${startDate} 00:00:00`,
    };
    contracts.set(subscription.key, row);
    return row;
  });

  const invoices = [];
  const payments = [];
  for (const invoice of billing.invoices) {
    const contract = contracts.get(invoice.subscription);
    const period = monthlyPeriod(now, invoice.periodMonthsAgo, contract.due_day);
    const id = ctx.id('invoice', invoice.key);
    invoices.push({
      id,
      subscription_id: contract.id,
      user_id: contract.user_id,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      due_date: period.dueDate,
      amount_minor: contract.amount_minor,
      currency: contract.currency,
      grace_days: contract.grace_days,
      status: invoice.status,
      issued_at: `${period.periodStart} 00:00:00`,
    });
    if (invoice.payment) {
      const paidAt = addDays(period.dueDate, invoice.payment.paidDaysAfterDue);
      payments.push({
        id: ctx.id('payment', invoice.key),
        invoice_id: id,
        amount_minor: contract.amount_minor,
        currency: contract.currency,
        method: invoice.payment.method,
        paid_at: paidAt,
        external_reference: invoice.payment.externalReference ?? null,
        note: '',
        reverses_id: null,
        recorded_by: signedBy,
        recorded_at: `${paidAt} 12:00:00`,
      });
    }
  }
  return { billing_plans, subscriptions, invoices, payments };
}

/**
 * Published tasks, their stages ordered 0..n-1 (UNIQUE per task), and the
 * task → topic and stage → lesson links. No `task_progress` or
 * `task_stage_progress`: checking a stage in is the tester's move.
 */
export function taskRows(dataset, ctx) {
  const tasks = [];
  const task_stages = [];
  const task_topic_links = [];
  const task_stage_topic_links = [];
  for (const task of dataset.tasks ?? []) {
    const id = ctx.id('task', task.key);
    tasks.push({ id, title: task.title, description: task.description ?? '', status: 'published', created_by: ctx.id('user', task.createdBy) });
    for (const topic of task.topics ?? []) task_topic_links.push({ task_id: id, topic_node_id: ctx.id('topic', topic) });
    task.stages.forEach((stage, order) => {
      const stageId = ctx.id('task-stage', `${task.key}/${stage.key}`);
      task_stages.push({ id: stageId, task_id: id, label: stage.label, sort_order: order });
      task_stage_topic_links.push({ stage_id: stageId, topic_node_id: ctx.id('topic', stage.topic) });
    });
  }
  return { tasks, task_stages, task_topic_links, task_stage_topic_links };
}

/** The comment thread(s) and likes. Parents precede replies (the FK needs it). */
export function commentRows(dataset, ctx) {
  const now = requireNow(ctx);
  const comments = dataset.comments ?? { entries: [], likes: [] };
  const ordered = [...comments.entries.filter((c) => c.parent === null), ...comments.entries.filter((c) => c.parent !== null)];
  const topic_comments = ordered.map((comment) => ({
    id: ctx.id('comment', comment.key),
    topic_node_id: ctx.id('topic', comment.topic),
    parent_comment_id: comment.parent === null ? null : ctx.id('comment', comment.parent),
    user_id: ctx.id('user', comment.user),
    body: comment.body,
    created_at: daysBefore(now, comment.postedDaysAgo),
  }));
  const comment_likes = (comments.likes ?? []).map((like) => ({
    comment_id: ctx.id('comment', like.comment),
    user_id: ctx.id('user', like.user),
    liked_at: daysBefore(now, like.likedDaysAgo),
  }));
  return { topic_comments, comment_likes };
}
