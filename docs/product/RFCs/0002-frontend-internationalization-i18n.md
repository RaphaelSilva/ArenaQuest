# RFC 0002: Frontend Internationalization (i18n) Strategy

**Date:** 2026-05-24  
**Status:** Implemented  
**Author:** Claude Code  
**Affected:** `apps/web` (Next.js 15 frontend)

---

## Summary

Implement build-time internationalization for ArenaQuest's frontend to support Portuguese (PT) and English (EN) as separate deployments. Each build contains only one language, resulting in minimal JS bundles and clean URLs.

## Motivation

ArenaQuest currently has mixed-language content—Portuguese UI text scattered alongside English labels—with no i18n mechanism. To scale to multi-language support efficiently:

1. **Performance:** Reduce JS bundle by eliminating unused language strings at build time
2. **Clarity:** Centralize all UI strings in a single source of truth (dictionaries)
3. **SEO:** Support clean URLs without locale prefixes (`/admin` vs. `/en/admin`)
4. **Deployment:** Align with existing Cloudflare Pages + Turborepo workflow

## Proposed Solution: Build-Time i18n

Generate **separate deployments per language** using environment variables at build time.

### Architecture

```
apps/web/src/i18n/
├── config.ts              # Language enum, constants
├── dict-en.ts             # English dictionary (all UI strings)
├── dict-pt.ts             # Portuguese dictionary (all UI strings)
├── get-dict.ts            # Load correct dict per NEXT_PUBLIC_LANGUAGE
└── index.ts               # Public exports

apps/web/src/context/
└── dict-context.tsx       # React context for client-side access
```

### Build & Deployment

**Build Command:**
```bash
# Portuguese (default)
make build-web

# English
NEXT_PUBLIC_LANGUAGE=en make build-web
```

**Deployment:**
- Create two Cloudflare Pages projects: `arenaquest-web-en`, `arenaquest-web-pt`
- Each `make deploy-web-{en,pt}` builds & deploys its language variant
- Language detection/routing handled at domain or router level

### Component Usage

**Server Components:**
```typescript
import { dict } from '@web/i18n/get-dict';

export default function AdminPage() {
  return <h1>{dict.admin.dashboard}</h1>;
}
```

**Client Components:**
```typescript
'use client';
import { useDict } from '@web/context/dict-context';

export function Header() {
  const dict = useDict();
  return <h1>{dict.admin.dashboard}</h1>;
}
```

## Alternatives Considered

### A. Runtime Switching (i18next, next-intl)
- **Pros:** Instant language switching, single deployment, locale prefixes (`/en/...`)
- **Cons:** Larger JS bundle (all languages included), runtime locale state, more complex build config
- **Verdict:** Rejected—contradicts goal of building per-language

### B. Database-Driven Translations
- **Pros:** Backend-managed, per-user language preference, extensible for content
- **Cons:** Requires API changes, D1 schema updates, runtime performance cost
- **Verdict:** Deferred to Phase 4 (future)

### C. Build-Time i18n (Selected ✅)
- **Pros:** Smallest JS, clean URLs, leverages Turborepo cache, simple source control
- **Cons:** Multiple builds (slower CI), language switching = redirect/refresh
- **Verdict:** Best fit for stated goal & infrastructure

## Implementation Plan

### Phase 1: Foundation (Day 1)
- [ ] Create `apps/web/src/i18n/` directory structure
- [ ] Write `dict-en.ts`, `dict-pt.ts` with all UI strings (~150–200 keys)
- [ ] Implement `config.ts` (Language enum, getLanguageFromEnv)
- [ ] Implement `get-dict.ts` (load dict at build time)
- [ ] Update `next.config.ts` to expose `NEXT_PUBLIC_LANGUAGE` env var
- [ ] Create `dict-context.tsx` for client-side access

### Phase 2: Component Migration (Day 2)
- [ ] Audit & extract all hardcoded strings from components
- [ ] Migrate admin pages (`/admin`, `/admin/users`, `/admin/topics`, etc.)
- [ ] Migrate auth pages (`/login`, `/register`)
- [ ] Migrate dashboard & catalog pages
- [ ] Test both language builds locally
- [ ] Update unit tests for dictionary access

### Phase 3: Deployment & QA (Day 1.5)
- [ ] Add `build-web-en`, `build-web-pt`, `deploy-web-en`, `deploy-web-pt` to Makefile
- [ ] Create Cloudflare Pages projects: `arenaquest-web-en`, `arenaquest-web-pt`
- [ ] Implement language detection/routing (subdomain or redirect)
- [ ] Deploy to staging, QA both language variants
- [ ] Production deployment

### Phase 4: Future Enhancements (Backlog)
- [ ] Per-user language preference in database
- [ ] Runtime language switching (requires `next-intl` or similar)
- [ ] Content localization (topics, tasks, media descriptions)
- [ ] Additional languages (Spanish, French, etc.)
- [ ] Date/number/currency formatting via `Intl` API

## Effort Estimate

| Phase | Duration | Notes |
|-------|----------|-------|
| Foundation | 1 day | Dictionary creation, env var setup |
| Integration | 1 day | Component migration, testing |
| Deployment | 4 hours | Cloudflare setup, QA, production deploy |
| **Total** | **2–3 days** | ~16–24 hours focused work |

## Tradeoffs & Risks

### Tradeoffs
| Aspect | Impact |
|--------|--------|
| **Language Switching** | Not instant; requires redirect/page reload |
| **Build Time** | Longer CI/CD (N builds × ~3–5 min each) |
| **Domain Management** | Multiple Cloudflare projects or subdomain routing |

### Mitigations
- Language detection via browser locale (`navigator.language`) → auto-redirect on landing
- Memoize builds in Turborepo cache to reduce rebuild overhead
- Use Cloudflare's native routing or a lightweight Worker for language detection

## Success Criteria

- [ ] Both EN & PT builds deploy successfully to Cloudflare Pages
- [ ] No missing translations (all UI strings covered)
- [ ] JS bundle size reduced by ~10–15% per language vs. runtime i18n
- [ ] Zero runtime locale state (dict is static per build)
- [ ] All tests pass for both languages
- [ ] Documentation updated in CLAUDE.md

## Questions & Future Decisions

1. **Language detection:** Automatic (Accept-Language header), manual (selector), or hardcoded subdomain?
2. **Content localization:** When to extend to topics, tasks, media descriptions?
3. **Additional languages:** Timeline for Spanish, French, etc.?
4. **Per-user preference:** Should we store language in user profile?

## References

- Next.js i18n docs: https://nextjs.org/docs/app/building-your-application/routing/internationalization
- Cloudflare Pages routing: https://developers.cloudflare.com/pages/
- Build-time i18n best practices: https://www.smashingmagazine.com/2021/09/next-intl-library/

---

## Appendix: Dictionary Structure Example

```typescript
// dict-en.ts
export const dictEn = {
  auth: {
    login: 'Sign In',
    logout: 'Sign Out',
    email: 'Email Address',
    password: 'Password',
  },
  admin: {
    dashboard: 'Admin Dashboard',
    manageUsers: 'Manage users, content, and platform settings',
    userManagement: 'User Management',
    goToUsers: 'Go to Users',
    topics: 'Topic Tree',
    tasks: 'Tasks',
    groups: 'Groups',
  },
  common: {
    loading: 'Loading...',
    error: 'Something went wrong',
    create: 'Create',
    edit: 'Edit',
    delete: 'Delete',
    save: 'Save',
    cancel: 'Cancel',
  },
} as const;

// dict-pt.ts
export const dictPt = {
  auth: {
    login: 'Entrar',
    logout: 'Sair',
    email: 'Endereço de Email',
    password: 'Senha',
  },
  admin: {
    dashboard: 'Painel Administrativo',
    manageUsers: 'Gerenciar usuários, conteúdo e configurações da plataforma',
    userManagement: 'Gerenciamento de Usuários',
    goToUsers: 'Ir para Usuários',
    topics: 'Árvore de Tópicos',
    tasks: 'Tarefas',
    groups: 'Grupos',
  },
  common: {
    loading: 'Carregando...',
    error: 'Algo deu errado',
    create: 'Criar',
    edit: 'Editar',
    delete: 'Deletar',
    save: 'Salvar',
    cancel: 'Cancelar',
  },
} as const;
```

---

## Sign-Off

- [ ] Product owner review
- [ ] Architecture review (cloud-agnostic, Ports & Adapters alignment)
- [ ] Engineering team consensus
- [ ] Ready for Phase 1 implementation
