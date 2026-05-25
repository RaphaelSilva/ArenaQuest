# ArenaQuest Internationalization (i18n) Proposal

## Executive Summary

ArenaQuest currently has mixed language content—Portuguese UI text alongside English labels. This proposal outlines a build-time i18n strategy that generates **separate deployments per language** without runtime switching overhead.

**Current State:**
- 110 React/TypeScript files with ~130 hardcoded strings scattered across components
- Mix of English (UI controls, "Sign in", "User Management") and Portuguese (hero copy, dashboard text)
- No i18n library; no locale preference mechanism
- Single deployment for all languages

---

## Approach Comparison

### Option A: Runtime Switching (Traditional i18n)
**Tools:** `i18next`, `next-intl`, `lingui`
- Single deployment serves all languages
- Switch language at runtime via URL prefix (e.g., `/en/...`, `/pt/...`) or dropdown
- Browser detects language via `Accept-Language` header
- Pros: One build, simple language switching, SEO with locale prefixes
- Cons: Larger JS bundle (all translations loaded), runtime overhead, complex build config

### Option B: Build-Time i18n (Recommended) ✅
**Tools:** `next-intl` (build mode) or custom setup + environment variables
- Generate **separate deployment per language** (e.g., `en.arenaquest-web.pages.dev`, `pt.arenaquest-web.pages.dev`)
- Each build includes only its language's strings (no bloat)
- Routes are identical across builds (`/admin`, `/tasks`), no `/en/` prefix needed
- Build script reads `LANGUAGE` env var, bakes it into the bundle
- Pros: Minimal JS, no runtime overhead, clean URLs, simple build config
- Cons: Multiple builds/deployments, language redirect logic needed at router/CDN level

### Option C: Content-Focused Localization
**Tools:** Database-driven translations
- Store UI strings in database, fetch at runtime per user preference
- Content (topics, tasks) can be language-specific
- Pros: Admin can manage translations, per-user language choice
- Cons: Complex API changes, DB schema updates, performance considerations

---

## Recommended Solution: Build-Time i18n (Option B)

### Why Build-Time?
1. **Clean URLs** — no `/en/` or `/pt/` prefix
2. **Optimal performance** — each build contains only one language (smaller bundle)
3. **Aligned with your monorepo** — Turborepo caching works cleanly
4. **Familiar deployment** — leverages existing Cloudflare Pages setup
5. **Matches stated goal** — "the build already for the desired language"

### Architecture Overview

```
apps/web/
├── src/
│   ├── i18n/
│   │   ├── config.ts              # Language config
│   │   ├── dict-en.ts             # English dictionary
│   │   ├── dict-pt.ts             # Portuguese dictionary
│   │   └── use-dict.ts            # React hook to access current dict
│   ├── app/
│   │   ├── layout.tsx
│   │   └── ... (other pages)
│   └── components/
│       └── ... (UI components)
├── next.config.ts                 # Language-aware build config
├── package.json
└── .env.local (dev only)
```

### File Structure: Translation Dictionaries

**`apps/web/src/i18n/config.ts`:**
```typescript
export type Language = 'en' | 'pt';

export const DEFAULT_LANGUAGE: Language = 'pt';

export const LANGUAGES = {
  en: 'English',
  pt: 'Português',
} as const;

// Read from env var at build time; default to DEFAULT_LANGUAGE for dev
export function getLanguageFromEnv(): Language {
  const lang = process.env.NEXT_PUBLIC_LANGUAGE ?? DEFAULT_LANGUAGE;
  return lang === 'en' || lang === 'pt' ? lang : DEFAULT_LANGUAGE;
}

export const CURRENT_LANGUAGE = getLanguageFromEnv();
```

**`apps/web/src/i18n/dict-en.ts`:**
```typescript
export const dictEn = {
  // Navigation & Auth
  auth: {
    login: 'Sign In',
    logout: 'Sign Out',
    email: 'Email Address',
    password: 'Password',
    register: 'Create Account',
  },
  // Admin Dashboard
  admin: {
    dashboard: 'Admin Dashboard',
    manageUsers: 'Manage users, content, and platform settings',
    userManagement: 'User Management',
    userManagementDesc: 'Create, edit, and manage user accounts and roles',
    goToUsers: 'Go to Users',
    // ... (rest of admin strings)
  },
  // Pages
  pages: {
    tasks: 'Tasks',
    taskDesc: 'Manage learning tasks and assessments',
    catalog: 'Catalog',
    // ... (rest of page strings)
  },
  // Common
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
```

**`apps/web/src/i18n/dict-pt.ts`:**
```typescript
export const dictPt = {
  // Navigation & Auth
  auth: {
    login: 'Entrar',
    logout: 'Sair',
    email: 'Endereço de Email',
    password: 'Senha',
    register: 'Criar Conta',
  },
  // Admin Dashboard
  admin: {
    dashboard: 'Painel Administrativo',
    manageUsers: 'Gerenciar usuários, conteúdo e configurações da plataforma',
    userManagement: 'Gerenciamento de Usuários',
    userManagementDesc: 'Criar, editar e gerenciar contas de usuários e funções',
    goToUsers: 'Ir para Usuários',
    // ... (rest of admin strings)
  },
  // Pages
  pages: {
    tasks: 'Tarefas',
    taskDesc: 'Gerenciar tarefas de aprendizado e avaliações',
    catalog: 'Catálogo',
    // ... (rest of page strings)
  },
  // Common
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

**`apps/web/src/i18n/get-dict.ts`:**
```typescript
import { CURRENT_LANGUAGE } from './config';
import { dictEn } from './dict-en';
import { dictPt } from './dict-pt';

function getDict() {
  if (CURRENT_LANGUAGE === 'en') return dictEn;
  if (CURRENT_LANGUAGE === 'pt') return dictPt;
  return dictPt; // fallback
}

// For server components
export const dict = getDict();

// For client components (context)
export function createDictProvider() {
  const currentDict = getDict();
  return currentDict;
}
```

**`apps/web/src/context/dict-context.tsx`** (optional, for client-side access):
```typescript
'use client';
import { createContext, useContext } from 'react';
import { dict } from '@web/i18n/get-dict';

const DictContext = createContext(dict);

export function DictProvider({ children }: { children: React.ReactNode }) {
  return (
    <DictContext.Provider value={dict}>
      {children}
    </DictContext.Provider>
  );
}

export function useDict() {
  return useContext(DictContext);
}
```

### Usage in Components

**Server Component:**
```typescript
import { dict } from '@web/i18n/get-dict';

export default function LoginPage() {
  return (
    <div>
      <h1>{dict.auth.login}</h1>
      <input placeholder={dict.auth.email} />
    </div>
  );
}
```

**Client Component:**
```typescript
'use client';
import { useDict } from '@web/context/dict-context';

export function HeroPanel() {
  const dict = useDict();
  
  return (
    <div>
      <h1>{dict.admin.dashboard}</h1>
      <p>{dict.admin.manageUsers}</p>
    </div>
  );
}
```

### Build Configuration

**`apps/web/next.config.ts`:**
```typescript
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd(), "../../"),
  },
  // Ensure env vars are available at build time
  env: {
    NEXT_PUBLIC_LANGUAGE: process.env.NEXT_PUBLIC_LANGUAGE || 'pt',
  },
};

export default nextConfig;
```

---

## Deployment Strategy

### Single Build (Default)
```bash
make build-web
# Builds with NEXT_PUBLIC_LANGUAGE=pt (Portuguese)
```

### Multi-Language Builds
Add to `Makefile`:

```makefile
# 🌍 BUILD — Multi-Language
build-web-en: ## Build apps/web for English
	NEXT_PUBLIC_LANGUAGE=en pnpm --filter web pages:build

build-web-pt: ## Build apps/web for Portuguese
	NEXT_PUBLIC_LANGUAGE=pt pnpm --filter web pages:build

deploy-web-en: ## Deploy English build to Cloudflare Pages
	NEXT_PUBLIC_API_URL="https://api.raphael-1d2.workers.dev" \
	NEXT_PUBLIC_LANGUAGE=en pnpm --filter web pages:build && \
	pnpm --filter web exec wrangler pages deploy .vercel/output/static \
	  --project-name=arenaquest-web-en

deploy-web-pt: ## Deploy Portuguese build to Cloudflare Pages
	NEXT_PUBLIC_API_URL="https://api.raphael-1d2.workers.dev" \
	NEXT_PUBLIC_LANGUAGE=pt pnpm --filter web pages:build && \
	pnpm --filter web exec wrangler pages deploy .vercel/output/static \
	  --project-name=arenaquest-web-pt

deploy-web-all: deploy-web-en deploy-web-pt ## Deploy both language builds
```

### Cloudflare Pages Projects

Create two projects in Cloudflare:
1. **arenaquest-web-en** — English deployment
2. **arenaquest-web-pt** — Portuguese deployment

Or use subdomain routing:
- `en.arenaquest-web.pages.dev` (English)
- `pt.arenaquest-web.pages.dev` (Portuguese)
- `arenaquest-web.pages.dev` → redirect/default to PT

### Language Detection & Routing

**Option 1: Router-Level Redirect** (server-side)
Create a Cloudflare Worker that routes based on subdomain or custom logic:
```typescript
// Pseudo-code — would run on your domain
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const lang = detectLanguage(request); // en | pt
    // Rewrite to appropriate Cloudflare Pages project
    return fetch(`https://${lang}.arenaquest-web.pages.dev${url.pathname}`);
  }
};
```

**Option 2: Client-Side Redirect** (JavaScript)
Place a tiny redirect script on a landing page that uses `navigator.language`:
```html
<script>
  const lang = navigator.language.startsWith('pt') ? 'pt' : 'en';
  window.location = `https://${lang}.arenaquest-web.pages.dev`;
</script>
```

**Option 3: Manual Language Selection**
Add a language switcher that links to the appropriate subdomain:
```typescript
<select onChange={(e) => {
  window.location = `https://${e.target.value}.arenaquest-web.pages.dev`;
}}>
  <option value="en">English</option>
  <option value="pt">Português</option>
</select>
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- [ ] Create i18n file structure (`dict-en.ts`, `dict-pt.ts`, `config.ts`)
- [ ] Extract all hardcoded strings from components
- [ ] Implement `useDict()` hook
- [ ] Add `NEXT_PUBLIC_LANGUAGE` env var support to `next.config.ts`
- [ ] Update `Makefile` with `build-web-en`, `build-web-pt` targets
- [ ] Write tests for dictionary access

### Phase 2: Integration (Week 2)
- [ ] Migrate admin pages to use dictionaries
- [ ] Migrate auth pages to use dictionaries
- [ ] Migrate dashboard/catalog pages
- [ ] Update all components with dynamic strings
- [ ] Test both language builds locally
- [ ] Update CI/CD pipeline

### Phase 3: Deployment (Week 3)
- [ ] Create Cloudflare Pages projects (arenaquest-web-en, arenaquest-web-pt)
- [ ] Set up language detection/routing logic
- [ ] Deploy both builds to staging
- [ ] QA both language builds
- [ ] Deploy to production
- [ ] Monitor for errors/issues

### Phase 4: Content Localization (Optional - Future)
- [ ] Consider extending to database-driven topic/task content
- [ ] Add user language preference in settings
- [ ] Support switching languages without page reload (requires runtime i18n like `next-intl`)

---

## Pros & Cons

### Pros ✅
| Aspect | Benefit |
|--------|---------|
| **Performance** | Each build contains only one language; smallest JS bundle |
| **Simplicity** | No runtime locale state; clean TypeScript types |
| **SEO** | Clean URLs; no need for canonical tags or locale-specific redirects |
| **Build Cache** | Turborepo caches builds per language independently |
| **Maintenance** | Centralized dictionaries; easy to audit translations |
| **Scaling** | Adding a 3rd language = add `dict-es.ts` and one line in `config.ts` |

### Cons ⚠️
| Aspect | Challenge |
|--------|-----------|
| **Multiple Builds** | Requires separate build & deploy per language (adds CI/CD overhead) |
| **Domain/Subdomain Management** | Need multiple projects or subdomain routing setup |
| **Language Switching** | Users cannot switch language on-the-fly; requires redirect/refresh |
| **Content Duplication** | Some copied deployments (Cloudflare Pages cost) |

---

## Cost & Effort Estimate

| Component | Estimate | Assumptions |
|-----------|----------|------------|
| **Dictionary Creation** | 2–4 hours | Extract ~200 strings, translate PT↔EN |
| **Component Migration** | 1–2 days | Refactor 40–50 components to use `dict` object |
| **Build/Deploy Setup** | 2–4 hours | Add Makefile targets, test both builds |
| **Cloudflare Setup** | 1 hour | Create projects, configure domain routing |
| **Testing & QA** | 4–6 hours | Full manual test in both languages |
| **Documentation** | 1 hour | Update CLAUDE.md with i18n guidelines |
| **Total** | **3–4 days** | ~24–32 hours of focused work |

---

## Comparison: Build-Time vs. Runtime i18n

| Metric | Build-Time (Recommended) | Runtime (i18next) |
|--------|--------------------------|-------------------|
| **JS Bundle Size** | Smaller (1 language per build) | Larger (all languages included) |
| **Language Switching** | Page redirect | Instant (same page) |
| **Build Time** | ~3min × N languages | ~5min (once, all languages) |
| **Deployment** | N separate deployments | 1 deployment |
| **Routing Complexity** | Subdomain/routing logic | URL prefixes (`/en/`, `/pt/`) |
| **SEO** | Clean, no hreflang needed | Requires hreflang tags |
| **API Dependency** | None (UI-only) | Can add backend support later |

---

## Next Steps

1. **Review this proposal** — confirm build-time approach aligns with your vision
2. **Finalize dictionary scope** — identify all 150–200 UI strings
3. **Create foundation** — implement i18n file structure (Phase 1)
4. **Migrate components** — update to use `useDict()` (Phase 2)
5. **Deploy & validate** — test both language builds end-to-end (Phase 3)
6. **Monitor & iterate** — track user feedback, add missing translations

---

## Appendix: Adding a New Language

Once the system is in place, adding a new language takes ~2 hours:

1. Create `apps/web/src/i18n/dict-es.ts` with Spanish strings
2. Update `apps/web/src/i18n/config.ts` to include `'es'` in `Language` type and `LANGUAGES` map
3. Add language check in `get-dict.ts`: `if (CURRENT_LANGUAGE === 'es') return dictEs`
4. Add Makefile target: `build-web-es`, `deploy-web-es`
5. Create Cloudflare Pages project `arenaquest-web-es`
6. Test and deploy

No changes needed to components, build config, or business logic. ✨

---

## Questions & Considerations

- **Who manages translations?** Currently manual (in code). Later, consider Figma for designers or a translation management tool (Crowdin, Lokalise).
- **Content localization (topics, tasks)?** Separate concern; can add database-driven translations later if needed.
- **RTL languages (Arabic, Hebrew)?** Would require CSS adjustments; not included in this initial proposal.
- **Per-user language preference?** Requires account field + session storage. Deferred to Phase 4.
- **Dynamic content (date formatting, numbers)?** Can use `Intl` API later if needed.
