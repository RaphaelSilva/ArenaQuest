# Task 03 — Backend: remover o hard delete morto do repositório de usuários

**Status:** 📝 Open  
**Team:** Backend API / Shared  
**Found in:** RFC 0013, retenção do ledger e anonimização de usuários  
**Priority:** Requires manual prioritization

## Summary

O contrato ativo `IUserRepository` expõe `delete(id): Promise<void>` e
`D1UserRepository.delete` executa `DELETE FROM users`, embora nenhum fluxo de produção o
chame. O endpoint administrativo `DELETE /v1/admin/users/{id}` já tem outra semântica:
faz soft delete ao alterar `status` para `inactive`, revoga os refresh tokens e preserva a
linha do usuário.

A capacidade de hard delete é, portanto, código morto com um efeito destrutivo maior que o
nome do endpoint público sugere. Depois da introdução do billing, ela também conflita com a
decisão aceita no RFC 0013 de manter contratos e o ledger financeiro referenciando a mesma
linha de usuário por meio de FKs `ON DELETE RESTRICT`.

Esta tarefa remove a capacidade de hard delete do **contrato ativo** e de seu adaptador D1.
Não cria anonimização, não muda o endpoint administrativo e não altera as FKs do billing.

## Contexto verificado

- `packages/shared/ports/i-user-repository.ts` é o contrato exportado por
  `packages/shared/ports/index.ts` e usado pelo container e pelos serviços atuais.
- `apps/api/src/adapters/db/d1-user-repository.ts` é sua implementação e contém o único
  `DELETE FROM users` alcançável por esse contrato.
- A única chamada encontrada é um teste unitário da própria operação em
  `apps/api/test/db/d1-user-repository.spec.ts`; não há consumidor de produção.
- `apps/api/src/routes/admin/users.ts` implementa `DELETE /admin/users/{id}` como
  `UPDATE users SET status = 'inactive'` por meio de `users.update`, seguido de
  `tokens.deleteAllForUser`. Também protege contra self-lockout e remoção do último admin.
- `apps/api/migrations/0026_create_billing_tables.sql` usa `ON DELETE RESTRICT` nas
  referências financeiras a `users`. O comportamento já é exercitado em
  `apps/api/test/db/billing-constraints.spec.ts`.
- `packages/shared/ports/i-database-adapter.ts` descreve um contrato futuro, não exportado,
  cuja interface genérica `IRepository` ainda inclui `delete`. Ele não é o contrato ativo e
  não deve ser ampliado ou redesenhado incidentalmente nesta tarefa.

## Objetivos

1. Tornar hard delete de usuário indisponível pela API interna tipada atualmente injetada.
2. Manter sem alteração o soft delete administrativo, inclusive revogação de sessão e
   proteções de lockout.
3. Preservar a defesa em profundidade das FKs de billing: histórico financeiro nunca é
   apagado em cascata com o usuário.
4. Manter a mudança pequena, compatível com os consumidores existentes e reversível por
   revert de código.

## Decisão arquitetural

**Remover o método, em vez de guardá-lo.**

Remover:

- `delete(id)` de `IUserRepository` em
  `packages/shared/ports/i-user-repository.ts`;
- `D1UserRepository.delete` e seu `DELETE FROM users`;
- o teste que afirma que o hard delete funciona;
- os stubs/no-ops de `delete` existentes em mocks tipados como `IUserRepository`.

Preservar:

- `DELETE /v1/admin/users/{id}` com a semântica atual de desativação;
- os testes de rota para status `inactive`, revogação de refresh tokens, self-lockout e
  último admin;
- todas as constraints `ON DELETE RESTRICT` introduzidas pelo billing e os testes que
  executam SQL direto para provar sua eficácia;
- o teste de `billing_standing_holds`, cujo `ON DELETE CASCADE` é deliberado para dados
  operacionais não contábeis.

Não adicionar um método substituto nesta tarefa. Uma futura anonimização deve ter um nome e
contrato explícitos (por exemplo, uma operação de domínio dedicada), política de autorização,
auditoria e tratamento de campos pessoais definidos em uma tarefa/RFC própria.

## Fluxo após a mudança

```text
Admin DELETE /v1/admin/users/{id}
        |
        v
validar existência + self-lockout + último admin
        |
        v
users.update(id, { status: inactive })
        |
        v
tokens.deleteAllForUser(id) + evento de auditoria
        |
        v
linha users e referências históricas permanecem

Qualquer DELETE FROM users feito fora da aplicação
        |
        +-- usuário com histórico financeiro --> D1 rejeita por ON DELETE RESTRICT
        `-- usuário sem referência restritiva --> fora da API suportada; operação manual
```

## Requisitos

### Funcionais

- O contrato público ativo `IUserRepository` não expõe uma operação de hard delete.
- O adaptador `D1UserRepository` não oferece método que execute `DELETE FROM users`.
- `DELETE /admin/users/{id}` continua retornando `204` e mantendo a linha com status
  `inactive` quando a operação é válida.
- A desativação continua revogando todos os refresh tokens do usuário.

### Segurança e integridade

- Não enfraquecer nem substituir `ON DELETE RESTRICT` em `subscriptions.user_id`,
  `subscriptions.signed_by`, `invoices.user_id`, `invoice_adjustments.applied_by`,
  `payments.recorded_by` e demais referências financeiras/auditáveis a `users`.
- Não introduzir `ON DELETE CASCADE`, deleção manual de dependências, bypass de foreign keys
  ou captura de erro que transforme falha de integridade em sucesso.
- Não renomear hard delete para soft delete: a operação suportada continua sendo
  `users.update(... status: inactive)` para deixar o efeito explícito.
- Não registrar dados pessoais adicionais nem alterar a política atual de auditoria.

### Não funcionais

- Nenhuma migration de banco é necessária.
- Nenhuma mudança de contrato HTTP, payload ou UI é permitida.
- A remoção deve ser detectável em compilação: consumidores ou mocks que ainda dependam de
  `IUserRepository.delete` precisam falhar no typecheck até serem ajustados.
- O comportamento de billing e autenticação deve permanecer coberto por testes automatizados.

## Escopo

### In

- Contrato ativo `packages/shared/ports/i-user-repository.ts`.
- Implementação `apps/api/src/adapters/db/d1-user-repository.ts`.
- Teste do repositório D1 que hoje legitima o hard delete.
- Mocks de teste tipados como `IUserRepository` que contenham um `delete` no-op apenas para
  satisfazer o contrato removido.
- Verificação dos testes existentes de soft delete administrativo e constraints do billing.

### Out

- Endpoint ou fluxo completo de anonimização/erasure request.
- Mudança de nome ou semântica do endpoint administrativo existente.
- Alteração da entidade `User`, de email, nome, password hash, roles ou dados relacionados.
- Retenção legal, prazo de retenção ou política fiscal.
- Redesign do contrato futuro e não exportado em `i-database-adapter.ts`.
- Remoção de hard deletes de outros agregados.

Se a implementação precisar anonimizar dados, alterar schema/FKs ou definir uma política de
erasure, interromper esta tarefa e migrar para **Rota A**: RFC/tarefa específica de
anonimização, com decisão humana sobre retenção, identidade substituta e auditoria.

## Alternativas consideradas

### A. Guardar `delete` no adaptador

Poderia exigir um token/capability interno, checar ausência de referências, ou retornar um
erro permanente. Rejeitada: não há caller legítimo; manter a operação amplia a superfície de
risco, cria uma política sem requisito e deixa disponível o caminho destrutivo que esta tarefa
pretende fechar. É mais complexo e menos seguro que remover código morto.

### B. Converter `delete` em soft delete

Rejeitada: o nome continuaria mentindo sobre o efeito e duplicaria a operação explícita
`update(status)`. Também poderia permitir que um novo caller contornasse as proteções de
self-lockout, último admin, revogação de sessões e auditoria existentes na rota.

### C. Manter como está e confiar apenas em `ON DELETE RESTRICT`

Rejeitada: as FKs protegem usuários com determinadas referências, mas não necessariamente
um usuário novo ou sem histórico financeiro. Defesa no banco deve complementar, e não
substituir, um contrato de aplicação de menor privilégio.

### D. Implementar anonimização agora

Rejeitada para esta tarefa: anonimização exige decisões sobre todos os campos e relações
pessoais, unicidade de email, OAuth, tokens, comentários, autoria e trilha de auditoria. Isso é
Rota A e não deve entrar como expansão silenciosa de uma remoção de método morto.

## Migração, compatibilidade e rollout

1. Remover o método do port primeiro; usar os erros TypeScript para localizar todos os
   consumidores e mocks estruturais.
2. Remover a implementação D1 e o teste positivo de hard delete.
3. Ajustar somente os mocks que possuíam `delete` para satisfazer a interface.
4. Executar testes focados do repositório, da rota de admin e das constraints de billing.
5. Executar lint, testes e build completos antes de merge.

Não há migração de dados nem rollout em fases: a mudança remove uma capacidade interna sem
callers de produção e não altera o artefato HTTP. O rollback é um revert de código. Reintroduzir
o método manualmente sem nova decisão arquitetural não é rollback operacional válido.

## Falhas e observabilidade

- Erros de compilação após remover o método indicam dependências não mapeadas; corrigir os
  callers apenas se forem mocks. Um caller de produção descoberto invalida a premissa e exige
  revisão desta decisão antes de prosseguir.
- Falha no teste `billing-constraints.spec.ts` indica regressão na defesa de retenção e bloqueia
  o merge.
- Falha nos testes de `DELETE /admin/users/{id}` indica mudança indevida no soft delete,
  revogação de sessão ou proteções administrativas e bloqueia o merge.
- Nenhuma métrica ou alerta novo é necessário, pois não há novo fluxo em runtime. Os eventos
  atuais de revogação de sessão permanecem inalterados.

## Critérios de aceitação

- [ ] `IUserRepository` exportado não contém `delete` nem outro método de hard delete.
- [ ] `D1UserRepository` não contém `DELETE FROM users` nem método equivalente.
- [ ] Não existe caller de produção de hard delete de usuário.
- [ ] Mocks tipados como `IUserRepository` compilam sem stubs `delete` obsoletos.
- [ ] O teste positivo “delete removes the record” foi removido; não foi substituído por um
      teste que legitime hard delete pela aplicação.
- [ ] Os testes da rota administrativa provam que a operação mantém a linha como `inactive`,
      revoga sessões e preserva as proteções de self-lockout/último admin.
- [ ] O teste de billing continua provando que D1 rejeita `DELETE FROM users` quando há
      histórico financeiro e que a linha pode ser atualizada sem romper o ledger.
- [ ] `apps/api/migrations/0026_create_billing_tables.sql` e suas FKs `ON DELETE RESTRICT`
      permanecem sem alteração.
- [ ] Nenhuma migration, endpoint de anonimização, mudança HTTP ou alteração de UI foi
      introduzida.
- [ ] `make test-api`, `make lint` e `make build` passam.

## Comandos de verificação

```bash
# Testes focados
cd apps/api
pnpm test test/db/d1-user-repository.spec.ts
pnpm test test/routes/admin-users.router.spec.ts
pnpm test test/db/billing-constraints.spec.ts
cd ../..

# Gates do repositório
make test-api
make lint
make build

# Revisão estática: o primeiro comando não deve encontrar hard delete no port/adaptador;
# o segundo deve mostrar somente SQL direto deliberado em testes de constraints/fixtures.
git grep -nE 'delete\(id: string\)|DELETE FROM users' -- \
  packages/shared/ports/i-user-repository.ts \
  apps/api/src/adapters/db/d1-user-repository.ts
git grep -n 'DELETE FROM users' -- apps/api/test
```

## Riscos e revisão posterior

| Risco | Mitigação |
|---|---|
| Caller de produção não identificado | Typecheck após remover o port; se existir, parar e revisar a decisão. |
| Confundir remoção do método com remoção do endpoint | Testes da rota e escopo explícito: o endpoint continua soft delete. |
| Enfraquecer retenção do ledger durante “limpeza” | Migration 0026 fora do escopo e teste de constraint obrigatório. |
| Expandir para anonimização parcial e insegura | Rota A obrigatória para qualquer erasure/anonymisation flow. |
| Contrato futuro continuar sugerindo delete genérico | Registrado como dívida separada; não exportado e fora do escopo para evitar redesign transversal. |

Reavaliar esta decisão somente quando existir um caso de uso legítimo de remoção física com
política de retenção explícita. Nessa revisão, exigir pelo menos: classificação de todos os
dados referenciados, autorização, auditoria, comportamento transacional, recuperação e prova
de que constraints contábeis não podem ser contornadas.
