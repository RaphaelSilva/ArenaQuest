/**
 * Unit tests for scripts/demo/extensions.mjs and the Task 14 sections of
 * sql.mjs / dataset.mjs — relative dates, unique constraints, grants and the
 * write policy of each table. No wrangler, no network.
 * Run with: node --test scripts/demo/extensions.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DatasetError, loadDataset, readReference, validateDataset } from './dataset.mjs';
import { billingRows, commentRows, eventRows, eventTimes, isPastEvent, monthStart, monthlyPeriod, taskRows } from './extensions.mjs';
import { demoId } from './ids.mjs';
import { loadSanitizeMarkdown } from './seed-demo.mjs';
import { billingSection, commentsSection, demoContext, eventsSection, tasksSection } from './sql.mjs';

const NOW = new Date('2026-09-29T10:00:00Z');
const HASH = 'pbkdf2:100000:00000000000000000000000000000000:' + 'a'.repeat(64);
const sanitizeMarkdown = await loadSanitizeMarkdown();
const reference = readReference();
const dataset = loadDataset('budo');
const id = (entity, key) => demoId('budo', entity, key);
const context = (now = NOW, sanitize = sanitizeMarkdown) =>
  demoContext({ label: 'budo', passwordHash: HASH, sanitizeMarkdown: sanitize, renderMarkdown: String, now });
const ctx = context();
const clone = () => structuredClone(dataset);

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Asserts `validateDataset` fails with a problem matching `pattern`. */
function assertRejects(data, pattern) {
  assert.throws(
    () => validateDataset(data, reference),
    (error) => {
      assert.ok(error instanceof DatasetError, error);
      assert.ok(error.problems.some((p) => pattern.test(p)), `no problem matches ${pattern}:\n${error.problems.join('\n')}`);
      return true;
    },
  );
}

// -- events -------------------------------------------------------------------

test('events: one published event per audience, flyer none, dates in the canonical UTC form', () => {
  const { events } = eventRows(dataset, ctx);
  assert.deepEqual(events.map((e) => e.audience).sort(), ['members', 'public', 'restricted']);
  for (const event of events) {
    assert.equal(event.status, 'published');
    assert.equal(event.flyer_status, 'none');
    assert.match(event.starts_at, SQLITE_DATETIME);
    if (event.ends_at !== null) assert.match(event.ends_at, SQLITE_DATETIME);
    assert.equal(event.created_by, id('user', 'admin'));
  }
  assert.equal(new Set(events.map((e) => e.slug)).size, events.length, 'events.slug is UNIQUE');
  assert.equal(new Set(events.map((e) => e.id)).size, events.length);
});

test('events: exactly one is past by the board predicate — at any hour of any day', () => {
  const start = Date.parse('2026-12-28T00:00:00Z'); // crosses a month and a year
  for (let hour = 0; hour < 24 * 6; hour += 1) {
    const now = new Date(start + hour * 3_600_000 + 59 * 60_000);
    const { events } = eventRows(dataset, context(now));
    const past = events.filter((e) => isPastEvent(e, now));
    assert.equal(past.length, 1, now.toISOString());
    assert.equal(past[0].audience, 'members');
  }
});

test('eventTimes: whole days from the run date at the given hour; null duration is open-ended', () => {
  assert.deepEqual(eventTimes({ startsInDays: 2, startHourUtc: 22, durationHours: 3 }, NOW), {
    starts_at: '2026-10-01 22:00:00',
    ends_at: '2026-10-02 01:00:00',
  });
  assert.deepEqual(eventTimes({ startsInDays: -2, startHourUtc: 0, durationHours: null }, NOW), { starts_at: '2026-09-27 00:00:00', ends_at: null });
  assert.equal(isPastEvent({ starts_at: '2026-09-28 09:59:59', ends_at: null }, NOW), true);
  assert.equal(isPastEvent({ starts_at: '2026-09-28 10:00:01', ends_at: null }, NOW), false);
  assert.equal(isPastEvent({ starts_at: '2026-09-28 11:00:00', ends_at: '2026-09-29 10:00:01' }, NOW), false);
});

test('events: the restricted event is granted to Demo class; the others carry no grant', () => {
  const { events, event_audience_group: grants } = eventRows(dataset, ctx);
  const restricted = events.find((e) => e.audience === 'restricted');
  assert.deepEqual(grants, [{ event_id: restricted.id, group_id: id('group', 'demo-class') }]);
});

test('events: content goes through the shared sanitiser', () => {
  const hostile = clone();
  hostile.events[0].content = '# Hi\n<script>alert(1)</script>[x](javascript:alert(1))';
  const [event] = eventRows(hostile, ctx).events;
  assert.doesNotMatch(event.content, /<script>|javascript:/);
  assert.throws(() => eventRows(dataset, { ...ctx, sanitizeMarkdown: undefined }), /sanitizeMarkdown/);
});

test('events SQL: upserted with the dates, flyer_status on insert only, grants DO NOTHING', () => {
  const { statements, counts } = eventsSection.build(dataset, ctx);
  assert.deepEqual(counts, { events: 3, event_audience_group: 1 });
  const upserts = statements.filter((s) => s.startsWith('INSERT INTO events '));
  for (const s of upserts) {
    assert.match(s, /starts_at = excluded\.starts_at/);
    assert.doesNotMatch(s, /flyer_status = excluded/);
  }
  assert.match(statements.at(-1), /^INSERT INTO event_audience_group .*\n.*\nON CONFLICT\(event_id, group_id\) DO NOTHING;$/);
});

// -- billing --------------------------------------------------------------------

test('billing: two plans in the active currency; snapshot contracts signed by the demo admin', () => {
  const rows = billingRows(dataset, ctx);
  assert.equal(reference.activeCurrency, 'BRL');
  assert.deepEqual(rows.billing_plans.map((p) => [p.amount_minor, p.currency]), [[15000, 'BRL'], [0, 'BRL']]);
  const plans = new Map(rows.billing_plans.map((p) => [p.id, p]));
  assert.deepEqual(rows.subscriptions.map((s) => s.user_id), [id('user', 'student-1'), id('user', 'student-2')]);
  assert.equal(new Set(rows.subscriptions.filter((s) => s.status === 'active').map((s) => s.user_id)).size, rows.subscriptions.length, 'one active per user');
  for (const s of rows.subscriptions) {
    const plan = plans.get(s.plan_id);
    assert.equal(s.contract_group_id, s.id);
    assert.equal(s.signed_by, id('user', 'admin'));
    assert.deepEqual([s.amount_minor, s.currency, s.cycle, s.grace_days], [plan.amount_minor, plan.currency, plan.cycle, plan.grace_days]);
    assert.equal(s.start_date, '2026-08-01');
  }
});

test('billing: one paid invoice with its payment, one open; periods follow the monthly cycle', () => {
  const { invoices, payments } = billingRows(dataset, ctx);
  assert.deepEqual(invoices.map((i) => [i.user_id, i.status, i.period_start, i.period_end, i.due_date]), [
    [id('user', 'student-1'), 'paid', '2026-08-01', '2026-09-01', '2026-08-10'],
    [id('user', 'student-2'), 'open', '2026-09-01', '2026-10-01', '2026-09-10'],
  ]);
  const paid = invoices.find((i) => i.status === 'paid');
  assert.deepEqual(payments.map((p) => [p.invoice_id, p.amount_minor, p.currency, p.method, p.paid_at]), [
    [paid.id, paid.amount_minor, 'BRL', 'pix', '2026-08-08'],
  ]);
  assert.equal(payments[0].recorded_by, id('user', 'admin'));
  const keys = invoices.map((i) => `${i.subscription_id}|${i.period_start}`);
  assert.equal(new Set(keys).size, keys.length, 'UNIQUE(subscription_id, period_start)');
});

test('billing dates: month arithmetic across a year boundary and a 31st', () => {
  const now = new Date('2027-01-31T23:59:59Z');
  assert.equal(monthStart(now, 1), '2026-12-01');
  assert.deepEqual(monthlyPeriod(now, 1, 10), { periodStart: '2026-12-01', periodEnd: '2027-01-01', dueDate: '2026-12-10' });
  assert.deepEqual(monthlyPeriod(now, 0, 28), { periodStart: '2027-01-01', periodEnd: '2027-02-01', dueDate: '2027-01-28' });
  for (const day of ['2026-03-01T00:00:00Z', '2026-03-31T23:00:00Z', '2027-01-01T00:00:00Z']) {
    const at = new Date(day);
    const { invoices, payments } = billingRows(dataset, context(at));
    for (const invoice of invoices) for (const field of ['period_start', 'period_end', 'due_date']) assert.match(invoice[field], ISO_DATE);
    assert.ok(payments.every((p) => p.paid_at < at.toISOString().slice(0, 10)), `payment in the past on ${day}`);
  }
});

test('billing SQL: plans upserted; contracts, invoices and payments inserted once', () => {
  const { statements, counts } = billingSection.build(dataset, ctx);
  assert.deepEqual(counts, { billing_plans: 2, subscriptions: 2, invoices: 2, payments: 1 });
  for (const s of statements) {
    if (s.startsWith('INSERT INTO billing_plans ')) assert.match(s, /DO UPDATE SET name = excluded\.name/);
    else assert.match(s, /ON CONFLICT\(id\) DO NOTHING;$/);
  }
});

// -- tasks ----------------------------------------------------------------------

test('tasks: one published task, three stages ordered 0..2, each linked to a Root 1 lesson', () => {
  const rows = taskRows(dataset, ctx);
  assert.equal(rows.tasks.length, 1);
  assert.equal(rows.tasks[0].status, 'published');
  assert.deepEqual(rows.task_topic_links, [{ task_id: rows.tasks[0].id, topic_node_id: id('topic', 'root-1') }]);
  assert.deepEqual(rows.task_stages.map((s) => s.sort_order), [0, 1, 2]);
  const lessons = dataset.tasks[0].stages.map((s) => s.topic);
  assert.ok(lessons.every((key) => /^root-1\/module-\d\/lesson-\d$/.test(key)), lessons.join());
  assert.deepEqual(
    rows.task_stage_topic_links.map((l) => l.topic_node_id),
    lessons.map((key) => id('topic', key)),
  );
  assert.equal(new Set(rows.task_stages.map((s) => s.id)).size, 3);
});

test('tasks SQL: sort_order written on insert only; no progress or XP row is seeded', () => {
  const { statements, counts } = tasksSection.build(dataset, ctx);
  assert.deepEqual(counts, { tasks: 1, task_stages: 3, task_topic_links: 1, task_stage_topic_links: 3 });
  for (const s of statements.filter((s) => s.startsWith('INSERT INTO task_stages '))) assert.doesNotMatch(s, /sort_order = excluded/);
  const all = [eventsSection, billingSection, tasksSection, commentsSection].flatMap((section) => section.build(dataset, ctx).statements);
  assert.ok(!all.some((s) => /^INSERT INTO (task_progress|task_stage_progress|topic_progress|xp_events|user_xp|user_badges) /.test(s)));
});

// -- comments -------------------------------------------------------------------

test('comments: student-1 asks, the tutor replies, student-2 likes — on one Root 1 lesson', () => {
  const { topic_comments: comments, comment_likes: likes } = commentRows(dataset, ctx);
  const lesson = id('topic', 'root-1/module-1/lesson-1');
  assert.deepEqual(
    comments.map((c) => [c.user_id, c.parent_comment_id, c.topic_node_id]),
    [
      [id('user', 'student-1'), null, lesson],
      [id('user', 'tutor'), comments[0].id, lesson],
    ],
  );
  assert.ok(comments[0].created_at < comments[1].created_at);
  assert.ok(comments.every((c) => SQLITE_DATETIME.test(c.created_at)));
  assert.deepEqual(likes.map((l) => [l.comment_id, l.user_id]), [[comments[0].id, id('user', 'student-2')]]);
  const { statements } = commentsSection.build(dataset, ctx);
  assert.ok(statements.every((s) => /DO NOTHING;$/.test(s)));
  assert.match(statements.at(-1), /ON CONFLICT\(comment_id, user_id\) DO NOTHING;$/);
});

test('extension rows need ctx.now', () => {
  const noClock = demoContext({ label: 'budo', passwordHash: HASH, sanitizeMarkdown, renderMarkdown: String });
  for (const build of [eventRows, billingRows, commentRows]) assert.throws(() => build(dataset, noClock), /ctx\.now/);
});

// -- validation -----------------------------------------------------------------

test('the baseline extensions validate, for every label', () => {
  for (const label of ['arenaquest', 'budo', 'spaziord']) assert.equal(loadDataset(label).events.length, 3, label);
});

test('validation: events — one past, grants only on restricted, slugs, audiences, dates', () => {
  let d = clone();
  d.events[0].startsInDays = -3;
  assertRejects(d, /exactly one event must be in the past \(found 2\)/);
  d = clone();
  d.events.find((e) => e.audience === 'restricted').groups = [];
  assertRejects(d, /restricted event needs at least one group/);
  d = clone();
  d.events[0].groups = ['demo-class'];
  assertRejects(d, /only a restricted event takes "groups"/);
  d = clone();
  d.events[1].slug = d.events[0].slug;
  assertRejects(d, /duplicate slug/);
  d = clone();
  d.events[0].slug = 'Not A Slug';
  assertRejects(d, /"slug" must be lowercase kebab-case/);
  d = clone();
  d.events[0].audience = 'everyone';
  assertRejects(d, /unknown audience "everyone"/);
  d = clone();
  d.events[0].startsInDays = -1;
  assertRejects(d, /"startsInDays" must be/);
  d = clone();
  d.events[0].durationHours = 30;
  assertRejects(d, /"durationHours"/);
});

test('validation: billing — currency, one active contract per user, paid ⇔ payment', () => {
  let d = clone();
  d.billing.currency = 'USD';
  assertRejects(d, /not the active currency "BRL"/);
  d = clone();
  d.billing.subscriptions[1].user = 'student-1';
  assertRejects(d, /already has an active subscription/);
  d = clone();
  delete d.billing.invoices[0].payment;
  assertRejects(d, /a paid invoice needs its "payment"/);
  d = clone();
  d.billing.invoices[1].payment = { method: 'pix', paidDaysAfterDue: 0 };
  assertRejects(d, /only a paid invoice carries a "payment"/);
  d = clone();
  d.billing.invoices[0].payment.method = 'cheque';
  assertRejects(d, /unknown payment method "cheque"/);
  d = clone();
  d.billing.invoices[0].payment.paidDaysAfterDue = 5;
  assertRejects(d, /"paidDaysAfterDue" must be an integer -9\.\.0/);
  d = clone();
  d.billing.invoices[1].subscription = 'student-1';
  d.billing.invoices[1].periodMonthsAgo = 1;
  assertRejects(d, /a second invoice for the same period/);
  d = clone();
  d.billing.signedBy = 'student-1';
  assertRejects(d, /signedBy "student-1" is not an admin/);
});

test('validation: tasks — stages link to lessons, at least one stage', () => {
  let d = clone();
  d.tasks[0].stages[0].topic = 'root-1/module-1';
  assertRejects(d, /is not a lesson/);
  d = clone();
  d.tasks[0].stages = [];
  assertRejects(d, /needs at least one stage/);
  d = clone();
  d.tasks[0].stages[1].key = d.tasks[0].stages[0].key;
  assertRejects(d, /duplicate key/);
});

test('validation: comments — no nested reply, no HTML, parent on the same topic, likes unique', () => {
  let d = clone();
  d.comments.entries.push({ ...d.comments.entries[1], key: 'nested', parent: 'answer' });
  assertRejects(d, /a reply to a reply/);
  d = clone();
  d.comments.entries[0].body = 'Hello <b>there</b>';
  assertRejects(d, /no HTML/);
  d = clone();
  d.comments.entries[1].topic = 'root-1/module-1/lesson-2';
  assertRejects(d, /a reply on another topic/);
  d = clone();
  d.comments.likes.push({ ...d.comments.likes[0] });
  assertRejects(d, /duplicate like/);
  d = clone();
  d.comments.entries[1].postedDaysAgo = 5;
  assertRejects(d, /a reply posted before its parent/);
});
