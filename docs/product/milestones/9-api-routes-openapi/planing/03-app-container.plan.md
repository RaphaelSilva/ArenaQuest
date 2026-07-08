# Plan — 03-app-container

**Task:** [03-app-container.task.md](../03-app-container.task.md)
**Source:** Milestone 9
**Assigned personas:** backend-developer
**Branch:** feature/m9/03-app-container.task

## Objective

Refactor the dependency injection pattern in `apps/api`. We will replace the flat `deps` bag containing 30+ properties passed to `AppRouter.register` with an aggregated `AppContainer` interface and `buildContainer` factory. Route registrars/builders will be refactored to accept targeted slices (subsets) of the container rather than the whole flat structure or the entire container.

## Affected areas

- `apps/api/src/container.ts` [NEW]
- `apps/api/src/index.ts`
- `apps/api/src/routes/index.ts`
- All route builders inside `apps/api/src/routes/*.router.ts` and `apps/api/src/routes/*.spec.ts` where signature changes apply.

## Step-by-step

### Backend

1. **Define `AppContainer` Interface & Factory**:
   Create `apps/api/src/container.ts`. Move the instantiation logic from `apps/api/src/index.ts`'s `buildApp` into `buildContainer(env: AppEnv): AppContainer`.
   The `AppContainer` interface must group dependencies into seven distinct contexts:
   - `identity`: users, tokens, activationTokens, passwordResetTokens, oauthAccounts, authService
   - `content`: topics, tags, media, storage
   - `engagement`: taskRepo, taskStages, taskLinks, commentRepo
   - `progress`: progressRepo, enrollmentRepo
   - `gamification`: questRepo, badgeRepo, gamificationRepo, missionRepo, xpEngine, streakEngine, questEvaluator, badgeEngine
   - `infra`: auth, mailer, rateLimiters (login, register, activate, forgotPassword), cors (allowedOrigins, strict), cookies (sameSite)
   - `controllers`: passwordController, accountController, googleOAuthController, registerController, activateController

2. **Refactor `buildApp`**:
   Modify `apps/api/src/index.ts`'s `buildApp` function to simply construct the container using `buildContainer(env)` and pass it down to `AppRouter.register(app, container)`.

3. **Update Route Builders to accept Slice Arguments**:
   Refactor `AppRouter.register` to receive `AppContainer` as its second parameter.
   For each child router under `routes/`, change their builder function signature to receive a targeted typed slice interface. For example:
   - `buildAuthRouter` takes `{ identity, gamification, controllers, infra }`
   - `buildTopicsRouter` takes `{ content, progress, gamification }`
   Update the router registrations inside `AppRouter.register` to pass only these specific slices.

4. **Verify Compile and Types**:
   Run TypeScript compiler checks to ensure all interfaces and signatures compile flawlessly.

## Acceptance Criteria mapping

| AC | Plan step(s) | Persona | Verification |
|---|---|---|---|
| `src/container.ts` exports `AppContainer` and `buildContainer` | Step 1 | backend-developer | Code review |
| `buildApp(env)` calls `buildContainer(env)` and passes slices | Step 2 | backend-developer | Code review of index.ts |
| Route builders receive bounded-context slices | Step 3 | backend-developer | Review route builder file signatures |
| `routes/index.ts` mounts the identical 20 routes | Step 3 | backend-developer | Review index.ts mounting calls |
| `make test-api`, `make test-web`, and `make lint` pass green | Steps 1-4 | backend-developer | Run verification commands |

## Risks & open questions

- **Import path aliases**: Make sure any file moving/creation imports dependencies correctly using `@api/*` or relative paths.
- **Wrangler / Env typing**: Keep `AppEnv` cleanly typed.

## Verification

- Run `make lint`
- Run `make test-api`
