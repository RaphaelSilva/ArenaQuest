# RFC 0001 — Otimização da suíte de testes de `apps/api`

- **Status:** Done
- **Autor:** raphaelsilva
- **Data:** 2026-05-24
- **Escopo:** `apps/api/test/**`

## Contexto

A suíte de testes de `apps/api` possui hoje **61 arquivos / 737 testes / ~11 647 linhas**, executando em **~65 s** locais (medido em `pnpm --filter @arenaquest/api test`, branch `develop`).

Perfil de tempo:

| Métrica | Valor |
|---|---|
| Duration (wall) | 63.76 s |
| transform | 13.70 s |
| collect | 1196.69 s (paralelo entre workers) |
| tests | 175.86 s |
| prepare | 158.03 s |

Top 10 arquivos por duração:

| Arquivo | Testes | Tempo |
|---|---:|---:|
| `routes/admin-users.router.spec.ts` | 53 | 8 825 ms |
| `routes/admin-topics.router.spec.ts` | 40 | 6 928 ms |
| `adapters/auth/jwt-auth-adapter.spec.ts` | 34 | 5 664 ms |
| `core/cors/origin-policy.spec.ts` | 40 | 5 555 ms |
| `routes/auth.router.spec.ts` | 12 | 5 048 ms |
| `routes/admin-media.router.spec.ts` | 26 | 4 906 ms |
| `db/d1-topic-node-repository.spec.ts` | 16 | 4 554 ms |
| `core/progress-service.spec.ts` | 16 | 4 481 ms |
| `controllers/admin-topics.controller.spec.ts` | 22 | 4 326 ms |
| `routes/comments.spec.ts` | 17 | 4 144 ms |

Toda a suíte roda sobre `@cloudflare/vitest-pool-workers`. Cada arquivo paga o boot de uma instância Miniflare (~2–3 s constantes) **mesmo quando o teste é puramente unitário com mocks**.

## Diagnóstico

Quatro classes de ineficiência foram identificadas:

### D1. Pool Workers para testes que não precisam dele

Vários arquivos não importam `cloudflare:test`, não tocam D1/R2/KV e nem `fetch` real, mas ainda pagam o boot do worker:

- `test/shared-roles.spec.ts`
- `test/controllers/health.controller.spec.ts`
- `test/controllers/auth.controller.spec.ts`
- `test/controllers/account.controller.spec.ts`
- `test/controllers/password.controller.spec.ts`
- `test/controllers/register.controller.spec.ts`
- `test/controllers/activate.controller.spec.ts`
- `test/controllers/topics.controller.spec.ts`
- `test/controllers/public-tasks.controller.spec.ts`
- `test/controllers/admin-users.controller.spec.ts`
- `test/controllers/admin-topics.controller.spec.ts`
- `test/controllers/admin-media.controller.spec.ts`
- `test/controllers/admin-badges.controller.spec.ts`
- `test/controllers/admin-tasks.controller.spec.ts`
- `test/controllers/admin-task-linking.controller.spec.ts`
- `test/controllers/admin-task-stages.controller.spec.ts`
- `test/controllers/google-oauth.controller.spec.ts`
- `test/controllers/discussion.repository.spec.ts`
- `test/core/auth/auth-service.spec.ts`
- `test/core/cors/origin-policy.spec.ts`
- `test/core/gamification/*.spec.ts` (xp/quest/streak/badge)
- `test/core/registration/registration-mail-handler.spec.ts`
- `test/adapters/auth/jwt-auth-adapter.spec.ts` (Web Crypto está disponível no Node ≥ 20)
- `test/routes/parse-cookie-samesite.spec.ts` (testa função pura, não rota)

Soma estimada: **~25 arquivos** pagando ~2 s de overhead desnecessário cada = **~50 s de tempo agregado** (mitigado por paralelismo, mas ainda 15–25 s de wall time).

### D2. Sobreposição controller spec ↔ router spec

Pares analisados:

| Controller spec | Router spec | Sobreposição estimada |
|---|---|---:|
| `auth.controller` (16) | `auth.router` (12) | ~80 % |
| `admin-topics.controller` (22) | `admin-topics.router` (40) | ~70 % |
| `admin-media.controller` (20) | `admin-media.router` (26) | ~85 % |
| `admin-users.controller` (vários) | `admin-users.router` (53) | ~70 % |
| `register.controller` | `register.router` | ~70 % |
| `password.controller` | `password.router` | ~70 % |
| `account.controller` | `account.router` | ~70 % |
| `activate.controller` | `activate.router` | ~70 % |
| `topics.controller` | `topics.router` | ~70 % |

O *router spec* monta o app Hono real e executa o controller pelo mesmo caminho. Cenários como "404 quando parentId não existe", "422 UNKNOWN_PREREQ", "sanitiza markdown", "WOULD_CYCLE" estão duplicados em ambos os layers para a maioria dos recursos. Sem regra clara de divisão, novas regras de negócio caem duas vezes na suíte.

### D3. Loops de auth-enforcement repetitivos

`admin-users.router.spec.ts` e `admin-topics.router.spec.ts` iteram um array de endpoints × 2 (401 sem token, 403 com student) gerando 10–14 testes praticamente idênticos por arquivo, que já são cobertos genericamente em `middleware/auth-guard.spec.ts`.

### D4. DDL duplicada em 29 arquivos

29 specs declaram blocos `CREATE TABLE IF NOT EXISTS …` inline em `beforeAll`. Cada arquivo paga ~100–300 ms para aplicar a batch, e qualquer mudança de schema precisa ser propagada manualmente — risco real de drift contra `migrations/`.

### D5. Testes de baixo sinal

- `test/shared-roles.spec.ts` — afirma `ROLES.ADMIN === 'admin'`. Testa uma constante string.
- `test/controllers/health.controller.spec.ts` — afirma `status === 'ok'` e `version === '0.1.0'`.
- `test/index.spec.ts` — `/health` em "unit style" + "integration style"; o mesmo `/health` é re-testado em `auth.router.spec.ts` como "regression".
- `test/routes/parse-cookie-samesite.spec.ts` — 11 testes para um `switch` de 4 ramos.

## Proposta

### P1. Dividir vitest em dois projetos (impacto estimado: −15 a −25 s wall, redução do uso de CPU em CI)

Reorganizar `vitest.config.mts` em dois *projects*:

- **`workers`** (atual): roda `test/routes/**`, `test/db/**`, `test/middleware/**`, `test/index.spec.ts`, `test/adapters/storage/r2-storage-adapter.spec.ts`.
- **`node`** (novo, sem pool de workers): roda `test/controllers/**`, `test/core/**`, `test/adapters/auth/jwt-auth-adapter.spec.ts`, `test/routes/parse-cookie-samesite.spec.ts`, `test/shared-roles.spec.ts`.

Critério: se o arquivo não importa `cloudflare:test`, ele vai para o projeto `node`.

### P2. Resolver overlap controller × router (impacto: −1 500 a −3 000 ms agregados)

Definir convenção e documentar em `apps/api/test/README.md`:

> **Router specs** cobrem somente HTTP: status codes, parsing de body/cookie, validação Zod (via `@ValidateBody`), shape de DTO de saída, headers, rate-limit, CORS, autenticação. **Não** repetem cenários de regra de negócio.
>
> **Controller specs** cobrem toda a regra de negócio com mocks (rápidos, no pool `node`). Erros mapeados (`ControllerResult`), efeitos colaterais em adapters, idempotência, branchings.

Refatoração por par (não em um só PR — uma task por recurso): remover dos *router specs* tudo que é regra de negócio coberta no controller spec equivalente, mantendo apenas 1–2 smokes de "200 → DTO esperado", "404 propaga", "403 sem role".

### P3. Consolidar auth-enforcement (impacto: −500 a −1 000 ms agregados)

- Manter `middleware/auth-guard.spec.ts` como **fonte única** para regras "401 sem token" e "403 com role errada".
- Remover dos *router specs* específicos os loops genéricos `endpoints.forEach(…)`. Manter no máximo **1 smoke por router** ("admin-X requer admin", "público requer login").

### P4. Extrair helper de migrations (impacto: −200 a −500 ms agregados; benefício de manutenção)

Criar `apps/api/test/helpers/apply-migrations.ts` que:
1. Carrega os arquivos SQL de `apps/api/migrations/` (ou uma lista curada por feature).
2. Expõe `await applyMigrations(env.DB, ['users', 'roles', 'topic_nodes', …])` para escolher um *subset*.
3. Substitui os 29 blocos `MIGRATION_SQL` inline.

Vantagem secundária: novas migrations passam a ser refletidas automaticamente, evitando drift.

### P5. Desativações e reduções (impacto: −300 a −600 ms)

| Arquivo / teste | Ação | Justificativa |
|---|---|---|
| `test/shared-roles.spec.ts` | **Remover** | Testa que uma string constante é igual a si mesma. Zero valor de defeito. |
| `test/controllers/health.controller.spec.ts` | **Remover** | `getHealth` retorna literais; coberto por `test/index.spec.ts`. |
| `test/index.spec.ts` — `/health` "unit style" | **Remover** | Duplica o "integration style" no mesmo arquivo. |
| `test/routes/auth.router.spec.ts` — `GET /health (regression)` | **Remover** | Já coberto em `test/index.spec.ts`. |
| `test/routes/parse-cookie-samesite.spec.ts` | **Reduzir para 4 testes** | "Strict", "Lax", "None"/default, "valor inválido → None + warn". Os 7 demais cobrem o mesmo switch. |
| `test/core/cors/origin-policy.spec.ts` × `test/routes/cors.router.spec.ts` | **Reduzir router para smoke** | 43 testes unitários no policy já cobrem o parser/matcher; o router deve manter apenas testes de comportamento HTTP (echo de Origin, credenciais, preflight). |

### P6. Reduzir iterações PBKDF2 onde ainda não foi feito

Auditar adapters/auth de testes que ainda usam `pbkdf2Iterations` padrão (100 000) — `register.router.spec.ts` é candidato. Custo de hash em testes deve ser ≤ 1 000 iterações.

## Impacto esperado consolidado

| Métrica | Antes | Depois (estimado) |
|---|---:|---:|
| Wall time local | ~64 s | **~30–40 s** |
| Arquivos | 61 | ~58 (−3 removidos) |
| Testes | 737 | ~680–700 |
| Tempo agregado em controller specs | ~35 s | ~10–15 s (pool `node`) |
| Linhas de DDL duplicada | ~2 500 | ~50 (helper compartilhado) |

## Plano de execução

| Fase | Entrega | Esforço |
|---|---|---|
| **F1** | RFC aprovado; criar issue por proposta | – |
| **F2** | P1 — separar vitest em dois projetos (sem mover testes ainda) | S |
| **F3** | P5 — remover testes triviais; reduzir CORS router; reduzir parse-cookie | S |
| **F4** | P4 — helper `apply-migrations`; migrar 5 arquivos como prova | M |
| **F5** | P3 — consolidar auth-enforcement | S |
| **F6** | P2 — refatorar pares controller/router por recurso (1 task por par, 8 pares) | L |
| **F7** | P4 — concluir migração dos 24 arquivos restantes | M |

## Riscos

- **Drift de cobertura na P2**: ao remover cenários do router spec, podemos perder regressões de wiring (controller existe mas não está montado na rota). **Mitigação**: manter sempre ≥ 1 smoke por endpoint no router e exigir checagem do diff de coverage.
- **DDL helper desatualizado**: se a fonte for um *subset* curado em vez das migrations reais, perdemos a vantagem anti-drift. **Mitigação**: ler de `apps/api/migrations/` quando viável.
- **Pool `node` perdendo paridade com Workers**: bindings como `crypto.subtle` existem no Node 20, mas pequenas divergências de runtime podem causar falsos verdes. **Mitigação**: o projeto `workers` continua sendo a fonte de verdade para qualquer teste que interaja com `env`/`fetch`.

## Decisão pendente

1. Aprovar a separação em dois *projects* (P1) como primeiro passo independente?
2. Adotar a convenção "router = HTTP / controller = lógica" (P2) ou inverter (manter cenários no router, controller só para edge cases)?
