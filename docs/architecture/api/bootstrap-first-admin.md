# Bootstrapping the First Admin on a Fresh Database

This procedure creates a working admin account on a new ArenaQuest D1 database
without ever persisting a known password hash. Estimated time: **5 minutes**.

---

## Prerequisites

- Wrangler authenticated (`wrangler whoami` shows your account).
- The D1 database created and migrations applied (`make migrate-db` or the equivalent
  `wrangler d1 migrations apply` command).
- The `apps/api` migrations **do not** include `scripts/dev/0004_seed_dev_users.sql`
  — that file is for local development only.

---

## Steps

### 1. Generate a strong password hash

From the repo root:

```bash
cd apps/api
pnpm run gen-hash -- --password '<your-strong-password>'
```

This prints a single `pbkdf2:210000:...` hash to stdout. Copy it — you will need it
in the next step.

> Use a password manager to generate and store the password.
> Minimum recommended length: 20 characters with mixed case, digits, and symbols.

### 2. Insert the admin user

Replace `<HASH>`, `<USER_ID>`, `<EMAIL>`, and `<NAME>` with your values:

```bash
wrangler d1 execute arenaquest-db --remote --command "
  INSERT OR IGNORE INTO users (id, name, email, password_hash, status)
  VALUES (
    '<USER_ID>',
    '<NAME>',
    '<EMAIL>',
    '<HASH>',
    'active'
  );
"
```

> Generate a UUID for `<USER_ID>` with `node -e "console.log(crypto.randomUUID())"`.

### 3. Assign the admin role

```bash
wrangler d1 execute arenaquest-db --remote --command "
  INSERT OR IGNORE INTO user_roles (user_id, role_id)
  VALUES (
    '<USER_ID>',
    'bace0701-15e3-5144-97c5-47487d543032'
  );
"
```

The role ID `bace0701-15e3-5144-97c5-47487d543032` is the deterministic UUID for the
`admin` role seeded by migration `0003_seed_roles.sql`.

### 4. Verify the login

```bash
curl -s -X POST https://<your-worker>.workers.dev/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<EMAIL>","password":"<your-strong-password>"}' \
  | jq .user
```

Expected: a JSON object with `"roles"` containing `"admin"`.

### 5. Immediately rotate the password (optional but recommended)

If you used a temporary password during setup, rotate it now via:

```bash
curl -s -X PATCH https://<your-worker>.workers.dev/admin/users/<USER_ID> \
  -H 'Authorization: Bearer <accessToken>' \
  -H 'Content-Type: application/json' \
  -d '{"name":"<NAME>"}'
```

A proper password-change endpoint is part of a future story. For now, update the hash
directly in D1:

```bash
# 1. Generate a new hash
NEW_HASH=$(cd apps/api && pnpm run gen-hash -- --password '<new-password>' 2>/dev/null)

# 2. Write it to the DB
wrangler d1 execute arenaquest-db --remote --command "
  UPDATE users SET password_hash = '${NEW_HASH}' WHERE email = '<EMAIL>';
"
```

---

## Troubleshooting

### "no such table: user_roles" or "no such table: users"

Migrations haven't been applied. Run:
```bash
wrangler d1 migrations apply arenaquest-db --remote
```

### Login returns 401 after following the steps

Check that:
1. The `user_roles` row was inserted (`OR IGNORE` silently skips duplicates but not
   failures — verify with a `SELECT`).
2. The role ID matches `bace0701-15e3-5144-97c5-47487d543032` (check `roles` table).
3. The `status` column is `'active'`, not `'inactive'`.

```bash
wrangler d1 execute arenaquest-db --remote --command "
  SELECT u.email, u.status, r.name AS role
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id
  WHERE u.email = '<EMAIL>';
"
```

### "forgot to link role" — user exists but has no admin role

```bash
wrangler d1 execute arenaquest-db --remote --command "
  INSERT OR IGNORE INTO user_roles (user_id, role_id)
  SELECT id, 'bace0701-15e3-5144-97c5-47487d543032'
  FROM users WHERE email = '<EMAIL>';
"
```

### "did not use OR IGNORE" — duplicate-key error on re-run

The `INSERT OR IGNORE` clauses in steps 2 and 3 make the commands idempotent. If you
wrote a plain `INSERT` and got a UNIQUE constraint error, the row already exists —
verify with a `SELECT` and proceed.

### Pre-deploy guard blocks the deploy

If `make deploy-api` fails with `[check-no-dev-seed] BLOCKED`, the dev-seed password
hash is present in the database. Identify the affected accounts from the printed list
and either:
- Delete them: `DELETE FROM users WHERE email = '<EMAIL>'`
- Or re-hash their passwords using step 1 → step 5 above.

Then re-run `make deploy-api`.

---

## Staging environment

All commands above work for staging — replace `arenaquest-db` with
`arenaquest-db-staging` and add `--env staging` to every `wrangler` call. The
pre-deploy check runs automatically as part of `make deploy-api-staging`.
