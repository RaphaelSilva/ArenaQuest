# Backup and restore runbook

**Scope:** production D1 databases and media buckets of every label (`arenaquest`,
`spaziord`, `budo`). Staging is disposable and is never backed up
([RFC 0021 §4](../product/RFCs/0021-release-candidate-previews-and-demo-seed.md)); KV holds only
rate-limit counters. Derived from [RFC 0025 §4](../product/RFCs/0025-ai-admin-assistant.md).

**Who runs this:** a human, at a terminal, with `wrangler login` done against the
Cloudflare account. Every restore command below is **tier 3**: the AI assistant may open
this page and fill in the placeholders, but it never executes a restore — see
[Never automate](#never-automate).

Placeholders: `<label>` is one of `arenaquest | spaziord | budo`. Every production
database is `<label>-db`, every media bucket `<label>-media`, every backup bucket
`<label>-backups`, and the wrangler environment of production is the label itself
(`--env <label>`), exactly as `make deploy-api-prod` and the backup scripts resolve
them from `config/labels/<label>.jsonc`.

---

## What exists

Written by `.github/workflows/backup.yml` (daily 07:30 UTC, drill Sunday 09:30 UTC) and
by the same scripts run by hand (`make backup-d1-prod LABEL=<label>`,
`make backup-r2-prod LABEL=<label>`, `node scripts/backup/drill.mjs`):

| Object in `<label>-backups` | Written by | Content |
|---|---|---|
| `d1/production/daily/YYYY/MM/DD/<stamp>.sql.gz` | `scripts/backup/export-d1.mjs` | gzipped `wrangler d1 export` of `<label>-db`; expires after `backup.retention.dailyDays` (35) |
| `d1/production/monthly/YYYY/MM/<stamp>.sql.gz` | `export-d1.mjs`, first run of a month | same bytes as that day's daily; expires after `backup.retention.monthlyMonths` (12) |
| `d1/production/manifest.json` | export, mirror and drill | the contract below; never expires |
| `r2/production/<key>` | `scripts/backup/mirror-r2.mjs` | a copy of `<label>-media/<key>`, same key under the prefix; an object deleted from the source stays here for `backup.retention.tombstoneDays` (90) |
| `r2/production/index.json` | `mirror-r2.mjs` | key → ETag/size of every mirrored object, with `removedAt` on tombstones |

`<stamp>` is the UTC instant with `-` for `:` (`2026-10-11T07-30-02Z`), so a key is a valid
file name everywhere.

**`manifest.json`** (`manifestVersion: 1`, the schema lives in `scripts/backup/manifest.mjs`):

- `d1.latest` — `{ ts, key, bytes, sha256, rowCounts, durationMs }` of the newest verified
  dump; `d1.history` the same entries newest last; `d1.monthly` one `{ month, key, ts }` per
  calendar month.
- `r2.lastRun` — `{ at, durationMs, copied, pending, failed, tombstoned, pruned, unchanged,
  sourceObjects, stoppedBy }` of the last mirror run. `pending > 0` means the mirror is
  behind (budget stop or failed copies) and the next run resumes.
- `drill` — `{ at, ok, dumpTs, dumpKey, mismatches, durationMs, error? }` of the last
  restore drill. `ok: false` lists per-table `{ table, expected, actual }` count
  differences, or `error` when the dump did not apply at all. A backup that has never been
  drilled is not counted as a backup by the status report (Task 11).

Everything is written through the public wrangler/S3 APIs with the label's own
credentials; nothing in this layout is served to users.

## CI secrets

Four **repository secrets** (GitHub → Settings → Secrets and variables → Actions). Names
only — no value is ever committed, printed or echoed by the workflow or the scripts:

| Secret | Used by | Notes |
|---|---|---|
| `CF_API_TOKEN` | every step (wrangler) | the same token the deploy workflows use; needs D1 read, R2 read/write on `<label>-backups` |
| `CF_ACCOUNT_ID` | every step (wrangler) | the same as the deploy workflows |
| `R2_ACCESS_KEY_ID` | the **R2 mirror** step only | an R2 API token (S3 API): read on `<label>-media`, read/write on `<label>-backups` — the same names as the Worker secrets, so the operator already holds a pair |
| `R2_SECRET_ACCESS_KEY` | the **R2 mirror** step only | its secret |

Locally, `wrangler login` replaces the first two; the mirror still needs the R2 pair in the
environment (`R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… make backup-r2-prod LABEL=<label>`),
never on the command line.

## Decide which restore

| Situation | Path | Window | Where it restores |
|---|---|---|---|
| Bad migration, bad bulk edit, a delete minutes to days ago; the database still exists | [1. Time Travel](#1-d1-time-travel) | the last **30 days**, to the second | in place, same `database_id` |
| The database is gone, corrupted beyond Time Travel, or you need a copy to inspect | [2. Restore a dump](#2-restore-a-dump) | 35 days daily, 12 months monthly | a new database (recommended) or the existing one |
| One or a few media objects deleted or overwritten | [3. R2 copy-back](#3-r2-copy-back) | 90 days after the deletion (tombstone window) | the media bucket, same key |

Time Travel first whenever it applies: it is a Cloudflare-side rewind with no file in the
loop. Record a bookmark **before** any restore — it is the undo of the restore itself.

## 1. D1 Time Travel

Rewind `<label>-db` to a point in the last 30 days. Nothing is downloaded; the Worker keeps
running against the same database id.

1. Record the current position (the undo). Keep the printed `bookmark`:

   ```bash
   pnpm --filter api exec wrangler d1 time-travel info <label>-db --env <label>
   ```

   Add `--timestamp=<ISO 8601>` to see the bookmark of a past instant instead:

   ```bash
   pnpm --filter api exec wrangler d1 time-travel info <label>-db --env <label> --timestamp=2026-10-11T06:00:00Z
   ```

2. Restore to a bookmark (the form `scripts/db/reset-remote.mjs` and the deploy CLI print)
   or to a timestamp:

   ```bash
   pnpm --filter api exec wrangler d1 time-travel restore <label>-db --bookmark=<bookmark> --env <label>
   pnpm --filter api exec wrangler d1 time-travel restore <label>-db --timestamp=2026-10-11T06:00:00Z --env <label>
   ```

   wrangler asks for confirmation. The restore is itself a new point in time: the
   bookmark from step 1 undoes it with the same `restore --bookmark=…` command.

3. Verify (§4). Rows written after the chosen instant are gone — if some must be kept,
   export them first with [a dump](#2-restore-a-dump) of the current state.

## 2. Restore a dump

For a lost or unusable database, or to inspect a past state without touching production.
A dump restores into an **empty** database: it carries its own `CREATE TABLE`s and the
`d1_migrations` rows, so no migration is applied first.

1. Pick the dump. `d1.latest.key` in the manifest is the newest verified one; any
   `d1.history[]` or `d1.monthly[]` entry works the same way:

   ```bash
   pnpm --filter api exec wrangler r2 object get <label>-backups/d1/production/manifest.json --file manifest.json --remote
   ```

2. Download it and check it against the manifest entry — **stop on a mismatch**, the
   object is not the one the export verified:

   ```bash
   pnpm --filter api exec wrangler r2 object get <label>-backups/<d1.latest.key> --file dump.sql.gz --remote
   sha256sum dump.sql.gz        # must equal d1.latest.sha256; its size must equal d1.latest.bytes
   gunzip --keep dump.sql.gz    # → dump.sql
   ```

3. Choose the target.

   **A. A new database (recommended — production keeps its id until you switch).**

   ```bash
   pnpm --filter api exec wrangler d1 create <label>-db-restored
   pnpm --filter api exec wrangler d1 execute <label>-db-restored --remote --file dump.sql
   ```

   `d1 execute` resolves a database that is not in `wrangler.jsonc` by its name in the
   account, so no `--env` is needed here. Inspect it (§4) before switching. To make it
   production: set its `uuid` as `environments.production.d1.id` in
   `config/labels/<label>.jsonc` and as `database_id` of the `DB` binding in
   `env.<label>` of `apps/api/wrangler.jsonc` (the name may stay `<label>-db` by renaming
   the database in the dashboard, or change both files consistently), then redeploy the
   Worker — `make deploy-api-prod DEPLOY_LABEL=<label>` (the CLI confirms; `DEPLOY_LABEL`
   defaults to `arenaquest`). Keep the old database until the
   switch is verified.

   **B. In place (the id must not change).** Record a Time Travel bookmark first (§1 step
   1) — it undoes everything below. The dump cannot apply over existing tables, so drop
   them: list them and generate the statements, never type table names from memory.

   ```bash
   pnpm --filter api exec wrangler d1 execute <label>-db --remote --env <label> --json \
     --command "SELECT type, name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"
   # → for each row: DROP VIEW "<name>"; / DROP TABLE "<name>";  (views first), run as one statement with
   pnpm --filter api exec wrangler d1 execute <label>-db --remote --env <label> --command "PRAGMA defer_foreign_keys = on; DROP TABLE \"…\"; …"
   pnpm --filter api exec wrangler d1 execute <label>-db --remote --env <label> --file dump.sql
   ```

   Put the Worker in front of a maintenance notice (or accept the gap) while this runs:
   between the drop and the end of the apply, requests fail.

4. Verify (§4). Row counts must match `d1.latest.rowCounts` of the dump you used — that is
   exactly what the weekly drill checks against a throwaway local copy.

## 3. R2 copy-back

An object deleted or overwritten in `<label>-media` is still in the mirror under the same
key, for 90 days after the deletion (`backup.retention.tombstoneDays`); after that it is
pruned. Nothing here touches D1: if the `media` row was deleted too, restore it with §1 or
§2 — the object alone is not visible to the application.

1. Confirm the key is mirrored (and when it was tombstoned):

   ```bash
   pnpm --filter api exec wrangler r2 object get <label>-backups/r2/production/index.json --file index.json --remote
   # the entry for "<key>" carries etag, size and, for a deleted object, removedAt
   ```

2. Download the mirrored object and put it back under its original key, with its content
   type (the `media` row's `content_type`, or a `HEAD` on the mirrored object):

   ```bash
   pnpm --filter api exec wrangler r2 object get <label>-backups/r2/production/<key> --file restored.bin --remote
   pnpm --filter api exec wrangler r2 object put <label>-media/<key> --file restored.bin --content-type <mime-type> --remote
   ```

3. Check it is byte-identical:

   ```bash
   pnpm --filter api exec wrangler r2 object get <label>-media/<key> --file check.bin --remote
   sha256sum restored.bin check.bin
   ```

The next mirror run sees the key present again with its ETag and clears the tombstone.
For **many objects** (a prefix, a whole bucket) use an S3 client against the profile's
`r2.s3Endpoint` with the R2 pair — the mirror key equals the source key under
`r2/production/`, so a prefix copy restores a prefix — e.g. with the AWS CLI:

```bash
aws s3 cp s3://<label>-backups/r2/production/<prefix> s3://<label>-media/<prefix> --recursive \
  --endpoint-url <r2.s3Endpoint>    # AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = the R2 pair
```

Tombstoned objects are copied back as well by a recursive copy: compare with `index.json`
if deleted objects must stay deleted.

## 4. Verify

- **Backup state** — `make backup-status-prod LABEL=<label>` (lands with Task 11): dump
  age, size delta, last drill, mirror lag, Time Travel window. Until then, read the
  manifest (§2 step 1).
- **Restored database** — row counts against the manifest's `rowCounts`:

  ```bash
  pnpm --filter api exec wrangler d1 execute <label>-db --remote --env <label> --json \
    --command "SELECT 'users' AS t, COUNT(*) AS n FROM \"users\" UNION ALL SELECT 'topic_nodes' AS t, COUNT(*) AS n FROM \"topic_nodes\""
  ```

  then `GET /health` on the API and a login in the backoffice.
- **Prove the dump restores without touching production** — the drill, by hand:

  ```bash
  node scripts/backup/drill.mjs --label <label> -e production --dry-run   # the plan, no call
  node scripts/backup/drill.mjs --label <label> -e production --yes --keep  # writes manifest.drill; --keep leaves the local copy
  ```

  `--keep` prints the temp dir holding `dump.sql` and the local `d1/` store, which
  `wrangler d1 execute arenaquest-db --local --persist-to <dir>/d1 --command …` can query.

## Never automate

The commands in §1–§3 are **restore commands**: each one overwrites or replaces production
data and has a window in which the application answers wrongly or not at all. They are
deliberately not wrapped in a Make target, a script or a workflow — a human types them, with
a bookmark recorded first. The assistant (RFC 0025 §5, tier 3) may print the exact
command with the placeholders filled in; it never runs it, and a tool that could is out of
scope by the milestone guardrail. Backups themselves (export, mirror, drill) are the only
automated part, and they only ever write to `<label>-backups`.
