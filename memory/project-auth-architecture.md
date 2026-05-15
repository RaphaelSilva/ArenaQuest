---
name: project-auth-architecture
description: Auth token is in-memory React state only — RSC server-side fetch is not possible without architecture change
metadata:
  type: project
---

The access token is stored in React state inside `AuthContext` (`apps/web/src/context/auth-context.tsx`). It is populated by calling `/auth/refresh` on mount (which reads an HttpOnly refresh token cookie). There is no access-token cookie that Next.js server components can read via `cookies()`.

**Why:** Auth is intentionally client-only with Web Crypto API; no external auth deps.

**How to apply:** When building pages that need authenticated data, use a `'use client'` component that reads `useAuth().accessToken` and calls the API in a single `useEffect`. Do NOT attempt `cookies()` RSC patterns for protected data — the token is not available server-side. To avoid client-side request waterfalls, aggregate endpoint calls (one `getDashboard(token)` instead of N separate calls).
