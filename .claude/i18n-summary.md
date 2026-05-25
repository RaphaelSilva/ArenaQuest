# i18n Strategy — Quick Summary

## TL;DR

**Recommended: Build-Time i18n** — Generate separate deployments per language (English & Portuguese) with no runtime overhead.

Each build contains only one language, resulting in smaller JS bundles and clean URLs (`/admin`, `/tasks`—no `/en/` prefix).

---

## Three Approaches Analyzed

### 1. Runtime Switching (i18next, next-intl)
- Single build, all languages in bundle
- Switch at runtime via URL prefix (`/en/...`, `/pt/...`) or dropdown
- **Trade-off:** Larger JS, more complex build, but instant language switching

### 2. Build-Time i18n (Recommended ✅)
- **Separate builds per language** → separate Cloudflare Pages deployments
- Each build has only its language baked in (smallest JS)
- Clean URLs, simple setup, leverages existing Turborepo caching
- **Trade-off:** Multiple builds/deployments, language switching requires page redirect

### 3. Database-Driven (Content-Focused)
- Store UI strings + topic/task content in backend
- Per-user language preference
- **Trade-off:** Requires API changes, adds complexity

---

## Why Build-Time?

✅ **Aligns with your goal:** "build already for the desired language"  
✅ **Performance:** Smallest JS per language (no bundle bloat)  
✅ **Simplicity:** No runtime locale state, no locale-switching UI  
✅ **Clean URLs:** No `/en/` or `/pt/` prefixes  
✅ **Scaling:** Adding Spanish = one new file + Makefile line  

❌ Trade-off: Multiple builds/deployments (3–5 min × N languages)  
❌ Language switching = redirect/refresh, not instant  

---

## Implementation Summary

### File Structure
```
apps/web/src/i18n/
├── config.ts           # Language config (en, pt)
├── dict-en.ts          # English strings { auth: { login: "Sign In" }, ... }
├── dict-pt.ts          # Portuguese strings { auth: { login: "Entrar" }, ... }
└── get-dict.ts         # Loads correct dict based on NEXT_PUBLIC_LANGUAGE env var
```

### Build with Language
```bash
# Default (Portuguese)
make build-web

# English
NEXT_PUBLIC_LANGUAGE=en make build-web

# Or new Makefile targets:
make build-web-en      # English
make build-web-pt      # Portuguese
```

### Deployment
```
arenaquest-web-en.pages.dev  →  English build
arenaquest-web-pt.pages.dev  →  Portuguese build
arenaquest-web.pages.dev     →  Redirect to user's preferred language
```

### Component Usage
```typescript
// Server component
import { dict } from '@web/i18n/get-dict';
<h1>{dict.admin.dashboard}</h1>

// Client component
import { useDict } from '@web/context/dict-context';
const dict = useDict();
<h1>{dict.admin.dashboard}</h1>
```

---

## Effort Estimate

| Phase | Duration | Task |
|-------|----------|------|
| Phase 1: Foundation | 1 day | Create dictionaries, extract strings, set up env var |
| Phase 2: Integration | 1 day | Migrate components to use `dict` object |
| Phase 3: Deploy | 4 hours | Setup Cloudflare projects, test, deploy |
| **Total** | **2–3 days** | ~16–24 hours focused work |

---

## Next Decision Points

1. **Confirm build-time approach** — is this aligned with your vision?
2. **Decide on language detection** — automatic redirect, manual selector, or hardcoded subdomain?
3. **Scope languages** — start with PT + EN, or plan for more?
4. **API/content localization** — phase this in later (Phase 4), or include in initial MVP?

---

## Detailed Proposal

Full analysis with code examples, alternatives, and phase-by-phase implementation plan is in:
→ **`.claude/i18n-proposal.md`**
