---
name: preview-candidate
description: Deploy, verify and report an ArenaQuest candidate preview on staging (API Workers Preview + Pages branch), and tear it down after the merge. Use when asked to "deploy the candidate preview", "preview m<N>", "redeploy the preview", "which user do I log in with on the preview", "update the PR with the preview" or "remove the preview". Picks a label whose staging is actually provisioned, runs the deploy CLI, smoke-tests both URLs, lists the demo accounts from the staging D1, asks (AskUserQuestion) before any teardown, and always ends with the same report — URLs, accounts, password tip, limitations, rollback bookmark and teardown command.
Triggers: preview candidate, deploy preview, candidate preview, redeploy preview, preview url, preview users, preview login, staging preview, delete preview, remove preview, preview-delete-staging, deploy-preview-staging
---

# preview-candidate

Drives `make deploy-preview-staging` end to end and turns its output into a report the
owner can act on without scrolling back. The deploy mechanics live in
`scripts/cloudflare/deploy.mjs` (`--preview`, see `CLAUDE.md` → *Previewing a candidate*
and `docs/onboarding.md`); this skill owns the **decisions around it** — which label,
whether the preview is usable, who logs in — and the **report**.

It never touches production, never writes a secret, and never runs on `main`.

## 1. Inputs

| Input | Source | Default |
|---|---|---|
| Candidate name | `CANDIDATE=`, or derived from `feature/m<N>/candidate` → `m<N>` | the current branch |
| Label | asked, or picked in §2 step 2 | the only label with a staging D1 |
| Scope | `api` · `web` · `all` (`--scope web` needs `API_URL=`) | `all` |
| PR | the open PR whose head is the candidate branch | looked up |

Run it from the **feature worktree** (`.worktrees/m<N>-candidate`), on the candidate
branch, with a clean tree that is pushed (`git status`, `git log origin/<branch>..`). The
preview is built from the checkout, so an unpushed commit would be previewed but not
reviewable. If the worktree is gone (the sweep removes it after the merge), stop and say
so — the PR is most likely merged and the next step is teardown (§7).

## 2. Preflight — read-only, all before any deploy

1. **Auth.** `pnpm --filter api exec wrangler whoami`. Not logged in → stop and point at
   `wrangler login` (local) or `CF_API_TOKEN` + `CF_ACCOUNT_ID` (CI).
2. **Pick the label.** `pnpm --filter api exec wrangler d1 list --json` and keep the labels
   in `config/labels/*.jsonc` whose staging D1 (`environments.staging.d1.name`) exists.
   - Exactly one → use it, and say why in the report (*"the only label with a staging D1"*).
   - Several and none requested → ask which one.
   - None → stop: staging is not provisioned (`make set-new-label LABEL=<l>`).
3. **Preview secrets — by name only, never print a value.** A preview deployment inherits
   no secret from the staging Worker; the CLI ships a per-deploy `JWT_SECRET` plus any
   `AQ_PREVIEW_<NAME>` found in the shell. Check whether `AQ_PREVIEW_R2_ACCESS_KEY_ID`,
   `AQ_PREVIEW_R2_SECRET_ACCESS_KEY` and `AQ_PREVIEW_GOOGLE_CLIENT_SECRET` are set.
   - Missing R2 pair → presigned **upload and download are off** in the preview. If the
     candidate's feature is media (uploads, viewers), say so and ask before deploying.
   - Missing Google secret → Google sign-in is off; password login still works.
4. **Dry run.** `make deploy-preview-staging LABEL=<l> CANDIDATE=<c> DRY_RUN=1` must plan
   every step (migration lint, bookmark, migrate, API preview, web build, Pages deploy,
   report). A dry run does not query Cloudflare, so it does not replace step 2.

## 3. Deploy

```bash
make deploy-preview-staging LABEL=<l> CANDIDATE=<c> > <scratchpad>/preview-<c>.log 2>&1
```

Capture from the log (the CLI prints them as `✔  <key>: <value>`):

- `API preview:` and `Web preview:` — the two URLs;
- `D1 bookmark:` and `Restore:` — the Time Travel bookmark taken **before** this deploy's
  migrations and its restore command;
- the highest migration in the applied table — the D1 is **shared** by the staging Worker
  and every preview of that label.

A failed step stops the CLI; report the failing step and its output, never retry blindly.
Redeploying the same candidate reuses its name, so both URLs stay stable.

## 4. Smoke test — report every check, pass or fail

| Check | Expect | A miss means |
|---|---|---|
| `GET <api>/health` | `200` | the Worker did not boot |
| `GET <web>/` | `200` | the Pages branch did not publish |
| `OPTIONS <api>/v1/topics` with `Origin: <web>` | `204` + `access-control-allow-origin: <web>` | the origin fails staging `ALLOWED_ORIGINS` |
| one route **of the candidate's own feature**, no token | `401` | `404` = the deployed API is not this branch |

The last row is the one that catches a wrong backend: an API from another checkout
answers the feature route with `404`, and the web then shows a misleading
"not found". Pick the route from the candidate's milestone (e.g. M23:
`/v1/topics/<uuid>/submissions/summary`).

A `500` or a browser "CORS error" is usually a Worker exception (error 1101) whose
response carries no CORS headers. `wrangler tail` does not see previews: read the
exception through Workers Observability and inspect `deployment.env` from
`wrangler preview --json`.

## 5. Accounts — from the staging D1, never a password

```bash
pnpm --filter api exec wrangler d1 execute <label>-db-staging --env <label>-staging --remote \
  --command "SELECT u.email, group_concat(r.name) AS roles, u.status FROM users u
             LEFT JOIN user_roles ur ON ur.user_id = u.id
             LEFT JOIN roles r ON r.id = ur.role_id
             GROUP BY u.id ORDER BY u.email"
```

- Expect the demo accounts (`demo.<role>@<label>.demo.invalid`, RFC 0021). The local
  `@arenaquest.dev` seed accounts **do not exist on staging** — say so, because it is the
  first thing someone tries.
- No demo account at all → offer `make db-seed-demo-staging LABEL=<l>`.
- **Password.** Every demo account shares `AQ_DEMO_PASSWORD`. It lives in no file and the
  database keeps only its PBKDF2 hash: never guess it, print it, log it or pass it as a
  flag. `make db-seed-demo-staging LABEL=<l>` sets a new one — hidden prompt, typed twice,
  at least 8 characters, plus a confirmation. The seed **upserts** the users
  (`scripts/demo/sql.mjs`, `usersSection`), so the hash of the existing accounts is
  rewritten. Run it only when asked, and let the owner type the password (never pipe it).
- For each role, say what it should see in **this** candidate (e.g. staff: *Todos* +
  *Minhas*; student: *Minhas* + *Da turma*).

## 6. Report — fixed template, in the user's language

Every deploy, redeploy or "which user?" question ends with this block. Fill every line;
write *n/a* rather than dropping one.

```
Preview <c> (<label> staging) — <short sha>

Web: <web url>
API: <api url>

Contas (senha única: AQ_DEMO_PASSWORD)
| E-mail | Papel | O que testar |
|---|---|---|
| demo.admin@<label>.demo.invalid | admin | <what this role sees in the candidate> |
| demo.creator@<label>.demo.invalid | content_creator | … |
| demo.student-1@<label>.demo.invalid | student | … |
| demo.tutor@<label>.demo.invalid | tutor | … |
Esqueceu a senha? `make db-seed-demo-staging LABEL=<label>` define uma nova (prompt oculto,
duas vezes, ≥ 8 caracteres) e regrava a senha das contas existentes.

Smoke test: API <code> · web <code> · CORS <ok|falhou> · <feature route> <code> sem login.
Limitações: <e.g. upload/download desligados — faltam AQ_PREVIEW_R2_*; Google sign-in desligado>.

Migrations aplicadas até <NNNN> no D1 compartilhado do staging <label>. Para desfazer:
pnpm --filter api exec wrangler d1 time-travel restore <db> --bookmark=<bookmark> --env <label>-staging

Por que <label>: <o único label com D1 de staging | escolhido por você>.
Depois do merge, a remoção (make preview-delete-staging LABEL=<label> CANDIDATE=<c>)
será perguntada antes de rodar.
```

The report only *names* the teardown command; it never runs it (§7).

**PR.** When the candidate has an open PR, put the same URLs, accounts table and
limitations under a `## Preview` section of its body. **Replace** that section on every
redeploy — never append a second one — and leave the rest of the body untouched.

## 7. Teardown

**Teardown is never automatic — always ask first.** Whenever teardown becomes relevant
(the owner mentions removing the preview, the PR is merged, the worktree was swept, or a
report is about to suggest it), stop and ask with the **`AskUserQuestion`** tool — an
open question, not a line buried in the report — before running anything:

- **question:** *"Remove the preview `<c>` from `<label>` staging (Worker preview + Pages
  branch `<c>`)?"*, stating whether the PR is merged;
- **options:** *"Yes, delete it"* · *"Dry run first"* · *"Keep it"*.

Only an explicit *"Yes"* (or *"Dry run first"*, then a second confirmation) runs it; no
answer, an ambiguous answer, or an earlier approval for another candidate means **keep**.
A request phrased as "remove the preview" still gets the question, because it deletes
what reviewers may have open.

```bash
make preview-delete-staging LABEL=<l> CANDIDATE=<c> DRY_RUN=1   # plan
make preview-delete-staging LABEL=<l> CANDIDATE=<c>             # delete
```

It removes the Worker preview and the Pages branch deployments. The migrations stay in
the shared staging D1 (they are part of `main` after the merge); mention the restore
command only if the owner wants the D1 rolled back. Report what was deleted, and drop the
`## Preview` section from a still-open PR.

## 8. Non-negotiables

- **Staging only.** Never `-e production`, never a `-prod` target; the CLI refuses
  production too, but this skill never asks it to.
- **Secrets by name only.** Never write, print, log or pass a secret value on argv —
  `AQ_DEMO_PASSWORD` and `AQ_PREVIEW_*` included.
- **`preview-delete-staging` only after an `AskUserQuestion` "Yes".** Never run it on
  inference — not after a merge, a sweep, or a "remove the preview" request (§7).
- **Every deploy reports its bookmark.** A deploy whose bookmark is missing is a failure.
- **Never kill a process this session did not start.** Another worktree's `wrangler dev`
  may hold `:8787`; local smoke tests use a free port.
- **Never `main`.** The preview is built from the candidate's worktree, never from the
  root checkout.
- **No silent degradation.** A missing secret, a single-label fallback or a failed smoke
  check is a line in the report, never omitted.
