---
name: ops-runbook
description: Answer ad-hoc operational questions about an ArenaQuest label with read-only SQL (through the Cloudflare D1 connector or `wrangler d1 execute`) after the `aq-mcp` tools have been tried. Use when asked "did billing run", "did billing run today on <label> <env>", "student activity this month", "who was active this week", "comments on topic X since Monday", "summarise the comments", "overdue invoices", "who is late", "is everything healthy", "was a backup made", "how many submissions are waiting", "how many notes on this topic", "who signed up this week", "how many topics are published". Carries the D1 names per label and environment (read from the profiles), a commented schema map, canned `SELECT`s verified on the local replica, the computed predicates that are not columns (past event, overdue invoice, effective topic access, active student) and the data-exposure rules: `SELECT` only, production only when the operator asks, private note bodies never read but always counted.
Triggers: ops runbook, did billing run, billing ran, student activity, active students, comments on topic, summarise comments, overdue invoices, who is late, overdue, is everything healthy, was a backup made, backup status, submissions waiting, pending submissions, notes on topic, who signed up, new sign-ups, topics by status, published topics, ad-hoc sql, query d1, d1 select
---

# ops-runbook

The semantic layer for operational questions that end in a `SELECT`. It exists so the
assistant does not rediscover, every session, which database a label uses, what the
tables mean, which predicates are computed rather than stored, and which rows it is not
allowed to read. The mechanics (D1, `wrangler`, the Cloudflare connector) are not
documented here; the **decisions** are — where to look first, which database, what is
allowed, and the queries that have been run before.

Scope: RFC 0025 §3.3, §3.4 and §6 (Plane B). Nothing here writes. Nothing here restores,
resets or deploys.

## 1. Look here first

Most operational questions have a tool answer that is cheaper, safer and already shaped
for the operator. Try the `aq-mcp` tier-1 tools (`docs/onboarding.md` → *The AI admin
assistant*) before writing SQL:

| Question | Tool, not SQL |
|---|---|
| Is the system healthy? Which migration is live? When did each job last run? | `system_health()` |
| Did billing (or the submissions sweep) run? With what result? | `job_runs(job?, since?, limit?)` |
| Was a backup made? How old is the dump? Did the drill pass? Mirror lag? | `backup_status()` — same report as `make backup-status-prod LABEL=<l>` |
| What is the Time Travel bookmark / window right now? | `time_travel_status()` |
| Do the D1, KV, R2, Pages resources exist? Which secrets are set (by name)? | `infra_status(env?)` |
| What does a topic say? Which comments did it get? | `read_topic(id)`, `topic_comments(id, since?)` |

Only when the question is not answered by those — a per-student breakdown, a date range
the tool does not take, a join across billing and enrollment — does the rest of this
skill apply. When the `aq-mcp` server is not registered in the session, say so and
offer the SQL path; do not silently fall through to it.

## 2. Which database

Never hard-code a D1 name or id. The label profile is the source of truth:

1. Open `config/labels/<label>.jsonc`.
2. Read `environments.<env>.d1.name` (and `.id` for the REST connector).
3. Say which one you are about to query, in the answer, before the first query.

The local replica is the exception: it is `arenaquest-db` in `apps/api/wrangler.jsonc`
(top-level `d1_databases`), reset and seeded by `make db-reset-local`, and queried from
`apps/api` with:

```bash
pnpm --filter api exec wrangler d1 execute arenaquest-db --local --command "<sql>"
```

Add `--json` for machine output. A remote query uses `--remote` with the profile's name
and `--env <label>-<env>`, or the Cloudflare D1 connector with the profile's id — subject
to §3.

## 3. Rules

These are the rules the task and RFC 0025 (§3.3, §6, Resolved Decision 6) place on
Plane B, stated here as the rule itself, not a paraphrase. They are not advisory. The
§6 data-exposure table they implement is reproduced after them.

> - **`SELECT` only.** No `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `DROP`, `ALTER`,
>   `PRAGMA` that writes, no `ATTACH`. A question that needs a write goes to the
>   backoffice or the API, never to SQL.
> - **Production only when the operator asks, and say so before running.** Default to
>   the local replica or staging. When the question names production, state
>   "production, read-only" in the answer before the first query runs.
> - **Bookmark first when a production session is ad hoc.** Before the first query of an
>   ad-hoc production session, record a D1 Time Travel bookmark
>   (`pnpm --filter api exec wrangler d1 time-travel info <db> --env <label>-production --json`,
>   or the `time_travel_status()` / `bookmark_now()` tools) and quote it in the answer.
>   Reads do not need it; the habit does, because the same connector can write.
> - **Never read `topic_notes.body` where `visibility = 'private'`.** Count them —
>   always, split by `visibility` — and every answer that involves notes carries the
>   fixed line: **"N private notes counted, not read"**, so a metric is never understated
>   and a missing body is never mistaken for a missing note. A `shared` body may be read
>   when the question asks for it.
> - **Never `users.password_hash`, `refresh_tokens`, `password_reset_tokens`,
>   `user_activation_tokens`, the token columns of `oauth_accounts`, or any secret
>   value.** Not in a `SELECT *`, not in a count's `WHERE`, not in a sample. Select the
>   columns you need by name on `users` and `oauth_accounts`.
> - **E-mail and phone only for one named person on request.** `users.email`,
>   `events.whatsapp_number` and any contact column leave the database only when the
>   operator asked about that one person or event by name.
> - **No row dumps of students in a summary.** A report aggregates; it names a person
>   only when the operator asked who, and never pastes a table of students as an answer
>   to a "how many" question.

Submission files (`topic_submissions.storage_key`) are never fetched either: the row's
metadata is data, the object is not.

RFC 0025 §6, verbatim — everything a tool returns is sent to the model provider:

| Data | Exposed? |
|---|---|
| Topics, media metadata, tags, published comments | Yes |
| Billing aggregates, invoice status, job runs, health | Yes |
| Student names and activity | Yes, on request; summaries refer to students by name only when asked |
| E-mail, phone/WhatsApp | Only when the operator asks for a specific person |
| Private student notes (`topic_notes`, `visibility = 'private'`) — **bodies** | **No** (Resolved Decision 6) |
| Private student notes — existence, author, date, visibility, **counts** | Yes; every answer that involves notes states how many private notes were counted but not read, so a metric never looks incomplete and a missing body never looks like a missing note |
| Submission files | **No**; metadata only |
| Password hashes, refresh tokens, secret values | **Never** |

## 4. Schema map

One line per group; the join keys are the ones the API uses. Columns are quoted from
`apps/api/migrations/*.sql` — read the migration before citing a column not listed here.
Timestamps are `TEXT` in UTC (`datetime('now')`), dates are `YYYY-MM-DD`.

| Group | Tables and join keys |
|---|---|
| Identity | `users(id, name, email, status, created_at, timezone)` — `password_hash` is off limits · `roles(id, name)` ∈ admin, content_creator, tutor, student · `user_roles(user_id, role_id)` · `user_groups(id, name)` · `user_group_members(group_id, user_id)` · `oauth_accounts` (never its token columns) |
| Enrollment and access | `enrollments_user(user_id, topic_node_id, granted_by, granted_at)` · `enrollments_user_group(group_id, topic_node_id, …)` · `topic_nodes.visibility` ∈ public, restricted, private · effective access is **computed** (§5) |
| Content | `topic_nodes(id, parent_id, title, content, status, visibility, archived, sort_order, estimated_minutes, created_at, updated_at)` — `status` is draft or published, `archived` is a flag · `topic_node_tags(topic_node_id, tag_id)` · `tags(id, name, slug)` · `topic_node_prerequisites(topic_node_id, prerequisite_id)` · `media(id, topic_node_id, uploaded_by, storage_key, original_name, type, size_bytes, status, created_at)` with `status` pending, ready, deleted |
| Engagement | `topic_comments(id, topic_node_id, parent_comment_id, user_id, body, created_at, deleted_at)` — a deleted comment keeps its row with `deleted_at` set · `comment_likes(comment_id, user_id, liked_at)` · `tasks`, `task_stages` (course tasks, not jobs) |
| Progress and gamification | `topic_progress(user_id, topic_node_id, status, completed_at, updated_at)` · `task_progress`, `task_stage_progress` · `xp_events(user_id, source_kind, source_id, points, earned_at)` · `user_xp(user_id, total_xp)` · `user_streak` · `badges`, `user_badges(user_id, badge_id)` · `level_definitions` · `missions`, `mission_progress` · `quest_definitions`, `quest_progress` |
| Billing (contract rail) | `currencies(code, exponent, symbol)` · `billing_plans(id, name, amount_minor, currency, cycle, grace_days)` · `subscriptions(id, user_id, plan_id, status, start_date, end_date, due_day, amount_minor, currency)` with `status` ∈ active, paused, cancelled, superseded · `invoices(id, subscription_id, user_id, period_start, period_end, due_date, amount_minor, currency, grace_days, status, issued_at, voided_at)` with `status` ∈ open, paid, void · `invoice_adjustments(invoice_id, kind, amount_minor)` · `payments(invoice_id, amount_minor, method, paid_at, reverses_id)` · `billing_standing_holds(user_id, reason, expires_at)` |
| Events (extras rail) | `events(id, slug, title, starts_at, ends_at, timezone, status, audience, flyer_status, created_by)` with `status` ∈ draft, published, archived and `audience` ∈ public, members, restricted · `event_audience_user(event_id, user_id)` · `event_audience_group(event_id, group_id)` · `event_prices` · `event_charges(id, event_id, user_id, due_date, amount_minor, currency, grace_days, status)` · `event_charge_adjustments`, `event_charge_payments` |
| Submissions and notes | `topic_submissions(id, topic_node_id, author_id, title, size_bytes, content_type, status, visibility, moderated_at, removed_at, created_at)` with `status` ∈ pending, ready, removed · `topic_notes(id, topic_node_id, author_id, body, visibility, revision, moderated_at, created_at, updated_at)` with `visibility` ∈ private, shared — **`body` only where `visibility = 'shared'`** |
| Ops | `job_runs(id, job, trigger, status, actor_id, started_at, finished_at, duration_ms, summary, error)` with `job` ∈ billing, sweep_submissions · `trigger` ∈ cron, manual · `status` ∈ running, ok, failed · `summary` is a JSON object of counts |
| Off limits | `refresh_tokens`, `password_reset_tokens`, `user_activation_tokens`, `users.password_hash`, `oauth_accounts` token columns |

## 5. Computed predicates

These are not columns. Use the reference SQL; do not invent a flag.

**Past event** — `apps/api/src/adapters/db/d1-event-repository.ts` (`anonymousVisibleSql`):
an event is past when its end, or its start plus one day when it has no end, is before now.

```sql
SELECT id, title, status, audience, starts_at, ends_at,
       COALESCE(ends_at, datetime(starts_at, '+1 day')) < datetime('now') AS is_past
FROM events
WHERE status = 'published'
ORDER BY starts_at DESC
LIMIT 20;
```

**Overdue invoice** — `invoices.status = 'open'` and `due_date` before today. `status` is
a cache of the balance (`apps/api/src/core/billing/billing-service.ts`), good enough for
a count; the *standing* the API computes also applies the invoice's own `grace_days` and
the real balance (`amount_minor` + adjustments − payments), so a "who is late" answer
should show `days_late` next to `grace_days` rather than decide for the operator.

```sql
SELECT i.id, i.due_date, i.grace_days,
       CAST(julianday('now') - julianday(i.due_date) AS INTEGER) AS days_late,
       i.amount_minor
         + COALESCE((SELECT SUM(a.amount_minor) FROM invoice_adjustments a WHERE a.invoice_id = i.id), 0)
         - COALESCE((SELECT SUM(p.amount_minor) FROM payments p WHERE p.invoice_id = i.id), 0) AS balance_minor,
       i.currency
FROM invoices i
WHERE i.status = 'open' AND i.due_date < date('now')
ORDER BY i.due_date ASC;
```

**Effective topic access** — `D1EnrollmentRepository.getEffectiveAccessTopicIds`
(`apps/api/src/adapters/db/d1-enrollment-repository.ts`). In words: the topics granted to
the user directly or through one of their groups, expanded to every descendant, united
with every non-archived `public` topic, minus every `private` topic (a private topic is
excluded even when granted or public). The catalog gate on top of this set also requires
`status = 'published'` and `archived = 0`. Reference SQL, parameter `:user_id`:

```sql
WITH RECURSIVE
  allow_seed(id) AS (
    SELECT topic_node_id FROM enrollments_user WHERE user_id = :user_id
    UNION
    SELECT eg.topic_node_id
      FROM enrollments_user_group eg
      JOIN user_group_members ugm ON ugm.group_id = eg.group_id
     WHERE ugm.user_id = :user_id
  ),
  allow_tree(id) AS (
    SELECT id FROM allow_seed
    UNION ALL
    SELECT tn.id FROM topic_nodes tn JOIN allow_tree ON tn.parent_id = allow_tree.id
  ),
  public_set(id) AS (
    SELECT id FROM topic_nodes WHERE visibility = 'public' AND archived = 0
  )
SELECT t.id, t.title, t.status, t.visibility
FROM topic_nodes t
WHERE t.id IN (SELECT id FROM allow_tree UNION SELECT id FROM public_set)
  AND t.id NOT IN (SELECT id FROM topic_nodes WHERE visibility = 'private')
ORDER BY t.title;
```

**Active student** — any row in the window in `xp_events`, `topic_progress`,
`topic_comments` (not deleted) or `topic_submissions` (not removed). There is no
"last seen" column; a login leaves no row. Parameter `:since`:

```sql
SELECT COUNT(DISTINCT user_id) AS active_students
FROM (
  SELECT user_id FROM xp_events WHERE earned_at >= :since
  UNION
  SELECT user_id FROM topic_progress WHERE updated_at >= :since
  UNION
  SELECT user_id FROM topic_comments WHERE created_at >= :since AND deleted_at IS NULL
  UNION
  SELECT author_id AS user_id FROM topic_submissions WHERE created_at >= :since AND status <> 'removed'
);
```

## 6. Canned queries

Parameters are written as `:name` placeholders; replace them with a quoted literal before
running (`:since` → `'2026-10-06'`, `:topic_id` → `'<uuid>'`, `:title_pattern` →
`'%Kata%'`, `:user_id` → `'<uuid>'`). Every query below ran against a freshly reset local
replica (`make db-reset-local`) before it was written here; a query that returns no row
on the replica (`job_runs` is empty locally) still ran. Nothing from the results is
pasted here.

### 6.1 Last billing runs — "did billing run?"

Prefer `job_runs(job: 'billing')`. The SQL, newest first:

```sql
SELECT job, trigger, status, actor_id IS NOT NULL AS by_a_person,
       started_at, finished_at, duration_ms, summary, error
FROM job_runs
WHERE job = 'billing'
ORDER BY started_at DESC
LIMIT 5;
```

"Did it run today?" is a count over today's UTC date; a `running` row older than a few
minutes is a run that died without recording its end.

```sql
SELECT COUNT(*) AS runs_today,
       SUM(status = 'ok') AS ok,
       SUM(status = 'failed') AS failed,
       SUM(status = 'running') AS still_running
FROM job_runs
WHERE job = 'billing' AND date(started_at) = date('now');
```

Swap `'billing'` for `'sweep_submissions'` for the daily sweep.

### 6.2 Overdue invoices per student — "who is late?"

Contract rail only. One row per student and currency; `oldest_due` is the invoice that
has waited longest. Show the name because the operator asked who; never add the e-mail
unless they ask for one person's.

```sql
SELECT u.name,
       COUNT(i.id) AS overdue_invoices,
       SUM(i.amount_minor) AS face_value_minor,
       i.currency,
       MIN(i.due_date) AS oldest_due,
       MAX(i.grace_days) AS grace_days
FROM invoices i
JOIN users u ON u.id = i.user_id
WHERE i.status = 'open' AND i.due_date < date('now')
GROUP BY u.id, i.currency
ORDER BY oldest_due ASC, u.name ASC;
```

`face_value_minor` ignores adjustments and payments; use the per-invoice balance query
in §5 when the amount matters. The extras rail is the same shape on `event_charges`:

```sql
SELECT u.name, e.title AS event, c.due_date, c.amount_minor, c.currency, c.grace_days
FROM event_charges c
JOIN users u ON u.id = c.user_id
JOIN events e ON e.id = c.event_id
WHERE c.status = 'open' AND c.due_date < date('now')
ORDER BY c.due_date ASC, u.name ASC;
```

### 6.3 Activity per student over a period — "who was active this month?"

Parameter `:since` (an ISO date or datetime, UTC). Counts per kind plus the latest
timestamp; a student with no row in the window is absent, so pair it with §5's
`active_students` count or the roster when "who was *not* active" is the question.

```sql
WITH activity AS (
  SELECT user_id, 'xp' AS kind, earned_at AS at FROM xp_events WHERE earned_at >= :since
  UNION ALL
  SELECT user_id, 'progress', updated_at FROM topic_progress WHERE updated_at >= :since
  UNION ALL
  SELECT user_id, 'comment', created_at FROM topic_comments WHERE created_at >= :since AND deleted_at IS NULL
  UNION ALL
  SELECT author_id, 'submission', created_at FROM topic_submissions WHERE created_at >= :since AND status <> 'removed'
)
SELECT u.name,
       SUM(a.kind = 'xp') AS xp_events,
       SUM(a.kind = 'progress') AS progress_updates,
       SUM(a.kind = 'comment') AS comments,
       SUM(a.kind = 'submission') AS submissions,
       MAX(a.at) AS last_activity
FROM activity a
JOIN users u ON u.id = a.user_id
GROUP BY u.id
ORDER BY last_activity DESC;
```

### 6.4 Comments on a topic since a date — "summarise the comments on X since Monday"

Find the topic first (titles are not unique; show the candidates and let the operator
pick when there is more than one):

```sql
SELECT id, title, status, visibility, archived, parent_id
FROM topic_nodes
WHERE title LIKE :title_pattern
ORDER BY title;
```

Then the thread, parameters `:topic_id` and `:since`. Deleted comments are dropped, as
`topic_comments(id, since?)` does. The body is read — comments are public to the topic's
readers — but the answer is a summary, not the transcript.

```sql
SELECT c.created_at,
       u.name AS author,
       c.parent_comment_id IS NOT NULL AS is_reply,
       (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.id) AS likes,
       c.body
FROM topic_comments c
JOIN users u ON u.id = c.user_id
WHERE c.topic_node_id = :topic_id
  AND c.created_at >= :since
  AND c.deleted_at IS NULL
ORDER BY c.created_at ASC;
```

### 6.5 Submissions waiting — "how many demonstrations are pending?"

Counts by state; `removed` rows are tombstones (no object, outside every quota).

```sql
SELECT status, visibility, COUNT(*) AS submissions, SUM(size_bytes) AS bytes
FROM topic_submissions
GROUP BY status, visibility
ORDER BY status, visibility;
```

A `pending` row older than 24 hours is what the next sweep deletes (the presigned PUT
never landed):

```sql
SELECT COUNT(*) AS stale_pending
FROM topic_submissions
WHERE status = 'pending' AND created_at < datetime('now', '-24 hours');
```

### 6.6 Notes per topic, split by visibility — counts only

The only shape a notes question takes. No `body` column appears; the answer carries
"N private notes counted, not read" with N from the second query.

```sql
SELECT t.title,
       n.visibility,
       COUNT(*) AS notes,
       SUM(n.moderated_at IS NOT NULL) AS moderated,
       MAX(n.updated_at) AS last_update
FROM topic_notes n
JOIN topic_nodes t ON t.id = n.topic_node_id
GROUP BY t.id, n.visibility
ORDER BY t.title, n.visibility;
```

```sql
SELECT COUNT(*) AS private_notes_counted_not_read
FROM topic_notes
WHERE visibility = 'private';
```

### 6.7 New sign-ups this week — "who signed up?"

Per day and role, last seven days. A user with no role row shows `NULL`.

```sql
SELECT date(u.created_at) AS day,
       r.name AS role,
       COUNT(*) AS signups,
       SUM(u.status = 'active') AS active
FROM users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
WHERE u.created_at >= datetime('now', '-7 days')
GROUP BY day, r.name
ORDER BY day, r.name;
```

### 6.8 Topics by status — "how much is published?"

```sql
SELECT status, visibility, archived, COUNT(*) AS topics,
       SUM(estimated_minutes) AS minutes
FROM topic_nodes
GROUP BY status, visibility, archived
ORDER BY status, visibility, archived;
```

Media by state, the course-content side only (`topic_submissions` is §6.5):

```sql
SELECT status, type, COUNT(*) AS files, SUM(size_bytes) AS bytes
FROM media
GROUP BY status, type
ORDER BY status, type;
```

### 6.9 Mirror and backup pointers — no SQL

"Was a backup made", "how old is the dump", "is the mirror behind", "when was the last
pull" are answered by `backup_status()` / `make backup-status-prod LABEL=<l>`, which read
the manifest in the backup bucket, not the database. A restore is a human's act:
`restore_instructions(scenario)` returns the command and the section of
`docs/operations/backup-restore.md`; this skill never runs it.

## 7. Answer format

Every answer built from SQL carries, in this order:

1. **Where it ran** — `<label> <env>, read-only`, and for production the bookmark:
   `production, read-only, bookmark <b>`.
2. **The answer**, aggregated. Name people only when the question asked who.
3. **The notes line** whenever a note table was touched: `N private notes counted, not
   read` (N may be 0 — say so, do not drop the line).
4. **The queries** that ran, verbatim, so the operator can re-run them.

Units: money is `amount_minor` in the row's `currency`; divide by
`10 ^ currencies.exponent` (BRL → 2) and show the `symbol`. Time is UTC in D1
(`datetime('now')`); `users.timezone` and `events.timezone` are the display zones, not the
storage. A `date('now')` boundary is a UTC day, which runs from 21:00 to 21:00 in
São Paulo — say so when a "today" count looks off by a few hours.
