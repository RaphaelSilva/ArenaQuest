# RFC 0003 — Reorganização de rotas e adoção de OpenAPI/Swagger em `apps/api`

- **Status:** Draft
- **Autor:** raphaelsilva
- **Data:** 2026-05-24
- **Escopo:** `apps/api/src/routes/**`, `apps/api/src/index.ts`, `apps/api/src/controllers/**` (assinaturas), documentação pública da API

## 1. Contexto

`apps/api` cresceu de um Worker com ~5 rotas (Milestone 01) para **~74 endpoints** distribuídos em **20 routers** sob `apps/api/src/routes/`. A organização atual reflete a sedimentação histórica das milestones (auth → topics → tasks → progress → gamification → comments) e não uma decisão deliberada de design.

Estado atual do `routes/index.ts`:

```ts
app.route('/', buildCommentsRouter(...));
app.route('/auth', buildAuthRouter({...}));                    // login, refresh, logout, register, activate, password
app.route('/admin/users', buildAdminUsersRouter(...));
app.route('/admin/topics', buildAdminTopicsRouter(...));       // CRUD de nodes
app.route('/admin/topics', buildAdminMediaRouter(...));        // ⚠️ mesmo prefixo, outro router
app.route('/admin/tasks', buildAdminTasksRouter(...));
app.route('/tasks', buildTasksRouter(...));
app.route('/tasks', buildProgressTaskRouter(...));             // ⚠️ mesmo prefixo
app.route('/topics', buildTopicsRouter(...));
app.route('/topics', buildProgressTopicRouter(...));           // ⚠️ mesmo prefixo
app.route('/me', buildMeProgressRouter(...));
app.route('/me', buildMeGamificationRouter(...));              // ⚠️ mesmo prefixo
app.route('/leaderboard', buildLeaderboardRouter(...));
app.route('/admin', buildAdminEnrollmentRouter(...));          // ⚠️ admin no root, não sob /admin/enrollments
app.route('/account', buildAccountRouter(...));
app.route('/auth', buildOAuthRouter(...));                     // ⚠️ /auth registrado em dois lugares
app.route('/admin/badges', buildAdminBadgesRouter(...));
app.route('/admin/missions', buildAdminMissionsRouter(...));
```

Cada handler segue o mesmo molde manual:

```ts
router.post('/', async (c) => {
  const body = await c.req.json();
  const result = await controller.create(body);
  if (!result.ok) return c.json({ error: result.error, ...result.meta }, result.status as 400 | 404 | 422);
  return c.json(result.data, 201);
});
```

Não existe contrato OpenAPI/Swagger publicado — o frontend (`apps/web`) consome a API a partir de tipos copiados manualmente em `src/lib/*-api.ts`, e o time de QA não tem fonte única de verdade para as rotas disponíveis.

## 2. Problemas identificados

### P1. Múltiplos routers compartilham o mesmo prefixo

`/admin/topics`, `/tasks`, `/topics`, `/me` e `/auth` são montados **mais de uma vez** com routers diferentes. Hono resolve isso por ordem de registro, mas o leitor humano precisa abrir os 2–3 arquivos para descobrir quem responde a `GET /tasks/:id`. Sintomas observáveis:

- `buildTopicsRouter` e `buildProgressTopicRouter` recebem ambos `topics`, `enrollmentRepo`, `xpEngine`, `streakEngine`, `questEvaluator`, `badgeEngine` — duplicação de DI porque a fronteira entre "conteúdo" e "progresso" foi diluída.
- Colisões silenciosas: se dois routers definirem `GET /:id` no mesmo prefixo, o segundo vira código morto sem warning.

### P2. Hierarquia administrativa inconsistente

- `buildAdminEnrollmentRouter` é montado em `/admin` (raiz), não em `/admin/enrollments`. O prefixo do recurso é declarado **dentro** do router, divergindo do padrão dos outros admin routers.
- `buildOAuthRouter` é montado em `/auth` mas adiciona rotas `/auth/google/*` — fica difícil saber, lendo apenas `routes/index.ts`, quais endpoints existem sob `/auth`.

### P3. `AppRouter.register` é um saco de dependências

A assinatura tem **30+ campos** em um único objeto plano (`auth`, `users`, `tokens`, `topics`, `tags`, `media`, `storage`, `taskRepo`, `taskStages`, `taskLinks`, `progressRepo`, `enrollmentRepo`, `questRepo`, `badgeRepo`, `gamificationRepo`, `missionRepo`, `commentRepo`, `xpEngine`, `streakEngine`, `questEvaluator`, `badgeEngine`, `authService`, `loginLimiter`, `registerController`, `registerLimiter`, `activateController`, `activateLimiter`, `passwordController`, `forgotPasswordLimiter`, `accountController`, `googleOAuthController`, `mailer`, `cookieSameSite`, `allowedOrigins`, `strictCors`).

Adicionar um endpoint novo exige tocar **3 arquivos** (`index.ts` para instanciar adapter, `routes/index.ts` para repassar, e o router de destino), e o tipo do parâmetro `deps` continua crescendo.

### P4. Boilerplate repetido em cada handler

Cada uma das ~74 rotas repete:

```ts
const body = await c.req.json();                                 // sem try/catch ⇒ throw 500 em JSON malformado
const result = await controller.xxx(body);
if (!result.ok) return c.json({ error: ..., ...result.meta }, result.status as 400 | 404 | 422);
return c.json(result.data);
```

Pontos problemáticos:
- `c.req.json()` sem tratamento de parse — payload inválido gera 500 em vez de 400.
- Cast `result.status as 400 | 404 | 422` é divergente entre handlers (alguns usam `as never`, outros listam códigos diferentes).
- Forma do envelope de resposta varia: `{ data }`, `{ data: ... }`, `result.data` solto, `c.body(null, 204)` — sem padrão único.

### P5. Sem OpenAPI/Swagger

Consequências práticas:
- O frontend mantém tipos espelhados manualmente; quando o backend muda um campo, o erro só aparece em runtime.
- A skill `qa-tester` precisa abrir o código-fonte para descobrir endpoints.
- Não há `/docs` para stakeholders e onboarding.
- Os schemas Zod usados via `@ValidateBody` (em `src/core/decorators.ts`) ficam isolados nos controllers e não viram contrato exportável.

### P6. Nomenclatura e granularidade inconsistentes

- `progress.router.ts` exporta **três** routers diferentes (`buildProgressTaskRouter`, `buildProgressTopicRouter`, `buildMeProgressRouter`) — um arquivo com três responsabilidades.
- `me-gamification.router.ts` vs progresso de `/me` espalhado em `progress.router.ts`.
- `tasks.router.ts` (público) vs `admin-tasks.router.ts` (backoffice) é um bom padrão, mas `comments.router.ts` é montado na raiz (`/`) sem prefixo e cuida de comentários de tópicos **e** de tarefas internamente.

### P7. Sem versionamento

Todas as rotas vivem em `/` sem `/v1`. Quando vier uma quebra de contrato (já há tickets no backlog para refactor de `TopicProgress`), não há caminho de migração além de quebrar o cliente.

## 3. Princípios da proposta

1. **Um prefixo, um sub-app.** Cada caminho de primeiro nível (`/auth`, `/admin`, `/me`, `/catalog`, `/leaderboard`) é dono de um único módulo Hono. Sub-recursos são montados **dentro** desse módulo, não como irmãos no `index.ts`.
2. **Roteamento declarativo com schema.** Migrar para `@hono/zod-openapi`: cada rota declara método, path, request schema, response schema(s) e tags. O OpenAPI 3.1 sai como subproduto da definição da rota.
3. **Handlers magros via helper de envelope.** Centralizar `ControllerResult → Response` em um único utilitário, eliminando o `if (!result.ok) ...` repetido.
4. **DI por domínio.** Substituir o "saco de 30 campos" por um `AppContainer` agrupado por bounded context (`identity`, `content`, `engagement`, `progress`, `gamification`, `infra`).
5. **Versionamento explícito.** Prefixo `/v1` em todas as rotas de negócio (mantendo `/health` e `/openapi.json` fora do versionamento).
6. **OpenAPI = fonte da verdade.** O JSON é gerado em build-time, comitado em `apps/api/openapi.json`, servido em `/openapi.json` e renderizado em `/docs` via Scalar. O frontend deriva tipos com `openapi-typescript`.

## 4. Proposta detalhada

### 4.1. Nova estrutura de pastas

```
apps/api/src/
├── routes/
│   ├── index.ts                       ← composição mínima (3 montagens, não 20)
│   ├── _shared/
│   │   ├── envelope.ts                ← respondWith(result), respondCreated(result)
│   │   ├── openapi.ts                 ← createRoute, registerCommonSchemas
│   │   └── error-schemas.ts           ← ErrorBody, ValidationErrorBody (Zod)
│   ├── public/
│   │   ├── health.ts
│   │   ├── catalog.topics.ts          ← GET /v1/catalog/topics/*
│   │   ├── catalog.tasks.ts           ← GET /v1/catalog/tasks/*
│   │   └── leaderboard.ts             ← GET /v1/leaderboard
│   ├── auth/
│   │   ├── index.ts                   ← compose login + register + activate + password + oauth
│   │   ├── login.ts
│   │   ├── register.ts
│   │   ├── activate.ts
│   │   ├── password.ts
│   │   └── oauth.google.ts
│   ├── me/
│   │   ├── index.ts                   ← compose progress + gamification + account
│   │   ├── account.ts                 ← /v1/me, PATCH profile, delete
│   │   ├── progress.ts                ← /v1/me/progress
│   │   ├── enrollments.ts             ← /v1/me/enrollments
│   │   ├── gamification.ts            ← /v1/me/xp, /v1/me/badges, /v1/me/quests
│   │   └── comments.ts                ← /v1/me/comments (write paths)
│   └── admin/
│       ├── index.ts                   ← guard requireRole(ADMIN) aplicado uma vez
│       ├── users.ts
│       ├── topics.ts                  ← inclui media (sub-rota /:id/media)
│       ├── tasks.ts                   ← inclui stages e linking (sub-rotas)
│       ├── badges.ts
│       ├── missions.ts
│       └── enrollments.ts
└── openapi/
    ├── document.ts                    ← OpenAPIHono root, info, servers, security
    └── components/
        ├── entities.ts                ← Zod schemas reutilizáveis (User, Topic, Task...)
        ├── pagination.ts
        └── errors.ts
```

Os controllers permanecem onde estão; só a camada de roteamento muda.

### 4.2. Padrão de rota declarativa

Exemplo do que substitui o handler manual de `admin-topics.router.ts`:

```ts
// routes/admin/topics.ts
import { createRoute, z } from '@hono/zod-openapi';
import { TopicNodeSchema, CreateTopicSchema } from '@api/openapi/components/entities';
import { respondWith, respondCreated } from '@api/routes/_shared/envelope';

export const createTopicRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['admin:topics'],
  summary: 'Create a topic node',
  security: [{ bearerAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: CreateTopicSchema } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: TopicNodeSchema } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: ValidationErrorBody } } },
    404: { description: 'Parent not found', content: { 'application/json': { schema: ErrorBody } } },
    422: { description: 'Domain rule violated', content: { 'application/json': { schema: ErrorBody } } },
  },
});

export function registerAdminTopics(app: OpenAPIHono, ctx: AdminCtx) {
  app.openapi(createTopicRoute, async (c) => {
    const body = c.req.valid('json');
    return respondCreated(c, await ctx.controllers.adminTopics.create(body));
  });
  // ... outras rotas
}
```

Ganhos diretos:
- Tipagem end-to-end: `c.req.valid('json')` é o tipo Zod inferido, sem cast.
- Validação automática 400 com corpo padronizado (`{ error: 'ValidationError', issues: [...] }`).
- `respondWith`/`respondCreated` centralizam o mapeamento `ControllerResult → Response`.
- A própria rota é a documentação OpenAPI.

### 4.3. Envelope unificado

`routes/_shared/envelope.ts`:

```ts
export function respondWith<T>(c: Context, r: ControllerResult<T>) {
  if (r.ok) return c.json(r.data, 200);
  return c.json({ error: r.error, ...(r.meta ?? {}) }, r.status);
}
export function respondCreated<T>(c: Context, r: ControllerResult<T>) {
  if (r.ok) return c.json(r.data, 201);
  return c.json({ error: r.error, ...(r.meta ?? {}) }, r.status);
}
export function respondNoContent<T>(c: Context, r: ControllerResult<T>) {
  if (r.ok) return c.body(null, 204);
  return c.json({ error: r.error, ...(r.meta ?? {}) }, r.status);
}
```

Elimina ~3 linhas de boilerplate × 74 handlers ≈ **220 linhas a menos**.

### 4.4. Container de dependências por domínio

Substitui o objeto-saco do `AppRouter.register`:

```ts
// src/container.ts
export interface AppContainer {
  identity: {
    authService: AuthService;
    users: IUserRepository;
    tokens: IRefreshTokenRepository;
    activationTokens: IActivationTokenRepository;
    passwordResetTokens: IPasswordResetTokenRepository;
    oauthAccounts: IOAuthAccountRepository;
  };
  content: { topics: ITopicNodeRepository; tags: ITagRepository; media: IMediaRepository; storage: IStorageAdapter };
  engagement: { taskRepo: ITaskRepository; taskStages: ITaskStageRepository; taskLinks: ITaskLinkingRepository; commentRepo: ICommentRepository };
  progress: { progressRepo: IProgressRepository; enrollmentRepo: IEnrollmentRepository };
  gamification: { questRepo: IQuestRepository; badgeRepo: IBadgeRepository; gamificationRepo: IGamificationRepository; missionRepo: IMissionRepository; xpEngine: XpEngine; streakEngine: StreakEngine; questEvaluator: QuestEvaluator; badgeEngine: BadgeEngine };
  infra: { auth: IAuthAdapter; mailer: IMailer; rateLimiters: { login: IRateLimiter; register: IRateLimiter; activate: IRateLimiter; forgotPassword: IRateLimiter }; cors: { allowedOrigins?: string; strict: boolean }; cookies: { sameSite: CookieSameSite } };
  controllers: { /* já agregados por feature */ };
}

export function buildContainer(env: AppEnv): AppContainer { /* ... */ }
```

`buildApp(env)` reduz a:

```ts
const ctx = buildContainer(env);
const app = new OpenAPIHono();
registerMiddleware(app, ctx.infra);
registerPublic(app, ctx);
registerAuth(app.basePath('/v1/auth'), ctx);
registerMe(app.basePath('/v1/me'), ctx);
registerAdmin(app.basePath('/v1/admin'), ctx);
registerDocs(app);
return app;
```

### 4.5. Geração e exposição do OpenAPI

- `/openapi.json` — JSON 3.1 gerado em runtime pelo `OpenAPIHono`.
- `/docs` — UI Scalar (`@scalar/hono-api-reference`), mais leve que Swagger UI e roda dentro do limite de bundle do Worker.
- Build script `apps/api/scripts/dump-openapi.ts` exporta `apps/api/openapi.json` comitado, usado por:
  - `apps/web` via `openapi-typescript apps/api/openapi.json -o apps/web/src/lib/api-types.gen.ts`;
  - validador de contrato em CI (`oasdiff` entre PR e `main`, falha em breaking changes não anotadas).

### 4.6. Versionamento

- Todas as rotas de negócio movem para `/v1/...`.
- `/health`, `/openapi.json`, `/docs` ficam fora do versionamento.
- `v0` (estado atual) pode ser mantido por um período de deprecação via rewrites no Worker se necessário — fora do escopo deste RFC.

## 5. Roadmap de migração

A migração é **incremental** — não há big-bang. `@hono/zod-openapi` é um superset do `Hono`; as duas APIs coexistem no mesmo `app`.

| Fase | Entregável | Esforço estimado |
|---|---|---:|
| F1 | Adicionar `@hono/zod-openapi` + `@scalar/hono-api-reference`; criar `OpenAPIHono` raiz; expor `/openapi.json` e `/docs` vazios | 0.5 dia |
| F2 | Helpers `respondWith`/`respondCreated`/`respondNoContent` + schemas comuns (`ErrorBody`, `ValidationErrorBody`, `Pagination`) | 0.5 dia |
| F3 | `AppContainer` e `buildContainer`; refatorar `index.ts` e `routes/index.ts` para o novo formato **sem mover rotas ainda** | 1 dia |
| F4 | Migrar domínio **público** (`/health`, `/catalog/topics`, `/catalog/tasks`, `/leaderboard`) — domínio menor, sem auth | 1 dia |
| F5 | Migrar `/auth` (login, register, activate, password, oauth) — consolidar os 5 routers em um módulo | 1.5 dia |
| F6 | Migrar `/me` (progress + gamification + account + enrollments) — elimina as 3 montagens duplicadas | 1.5 dia |
| F7 | Migrar `/admin` (users, topics+media, tasks+stages+linking, badges, missions, enrollments) — maior módulo | 2 dias |
| F8 | Introduzir prefixo `/v1` global; configurar rewrites legados em `wrangler.toml` para `/auth/*` → `/v1/auth/*` (apenas para clientes antigos durante o cutover) | 0.5 dia |
| F9 | Gerar `apps/api/openapi.json` em CI; gerar tipos no `apps/web`; adicionar `oasdiff` contract check no PR pipeline | 1 dia |
| F10 | Remover decorators `@ValidateBody` redundantes nos controllers (validação agora no router via Zod-OpenAPI) | 1 dia |

**Total:** ~10.5 dias-pessoa, incrementais, cada fase entregável independente e com testes passando.

Cada fase mantém compatibilidade de path com a versão anterior — frontend não quebra durante a migração.

## 6. Alternativas consideradas

- **`hono-openapi`** (lib comunitária) em vez de `@hono/zod-openapi` — descartada: menos manutenção ativa, sem suporte first-class a Zod 3.
- **tRPC** sobre Hono — descartado: quebra o contrato REST que mobile e integrações externas (Resend webhooks no futuro) precisam consumir; também adiciona um adapter no `apps/web` para algo que OpenAPI resolve.
- **Manter Hono "cru" e só gerar OpenAPI manualmente** (`zod-to-openapi` standalone) — descartada: schema e rota ficam em arquivos diferentes, drift é inevitável.
- **Nenhuma mudança, só adicionar Swagger** — descartada: P1–P4 continuam custando tempo em cada feature nova; só documentar a confusão não resolve a confusão.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Regressão em rotas críticas (`/auth/login`, `/admin/users`) durante a migração | Cada fase tem PR isolado com a suíte de testes existente (61 arquivos, 737 testes) precisando passar |
| Aumento do bundle do Worker (limite 1 MB comprimido) | `@hono/zod-openapi` + `@scalar/hono-api-reference` somam ~120 KB; medir após F1 e mover Scalar para `/docs` lazy-load se necessário |
| Drift entre `openapi.json` comitado e código | Job de CI roda `pnpm dump-openapi` e falha se o diff for não-vazio |
| Breaking changes implícitas durante refactor | `oasdiff` no pipeline a partir de F9; fases F4–F7 mantêm path 1:1 |
| Quebra de clientes legados ao introduzir `/v1` (F8) | Rewrites no Worker mantêm `/auth/*` respondendo durante uma janela de deprecação documentada |

## 8. Métricas de sucesso

- `routes/index.ts` cai de **20 montagens** para **5** (`public`, `auth`, `me`, `admin`, `docs`).
- Handlers caem de **~5 linhas médias de boilerplate** para **1 linha** (`return respondWith(c, await ctrl.x(input))`).
- **0** prefixos compartilhados por mais de um router.
- `apps/web` consome tipos gerados em `apps/api/openapi.json` — drift de tipos detectado em CI, não em runtime.
- `/docs` acessível em staging e produção com 100% das rotas listadas e exemplos navegáveis.

## 9. Decisões pendentes (a fechar antes do F1)

1. Versionamento: `/v1` no path ou no header `Accept: application/vnd.arenaquest.v1+json`? Recomendação: path (mais legível no Cloudflare Analytics e curl).
2. Renderer de docs: Scalar (recomendado) vs Swagger UI vs Redoc.
3. Política de contrato: `oasdiff` falha em qualquer breaking change ou exige label `breaking-change` no PR? Recomendação: falha hard; label desbloqueia.
4. Manter os decorators `@ValidateBody` em controllers para uso fora de HTTP (jobs, testes), ou removê-los completamente? Recomendação: remover — a fronteira de validação é o router.
