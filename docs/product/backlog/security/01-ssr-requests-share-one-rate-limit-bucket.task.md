# Task 01 — Backend: every server-rendered request shares one IP rate-limit bucket

**Status:** 📝 Open
**Team:** Backend API
**Found in:** Milestone 20, Task 05 (public events board), 2026-09-22 — **measured, unresolved**

## Summary

`/v1/events`, `/v1/events/{slug}` and `/v1/events/{slug}/flyer` are IP-rate-limited at
60 req/min on `CF-Connecting-IP` (Milestone 20, Task 03) because they are the first
endpoints in the product reachable without an account.

The public board is server-rendered, so those requests are made by the **Next server**, not
by the visitor's browser. Measured with a probe Worker under `wrangler dev`, with a Next dev
server pointed at it:

```
SSR subrequest  {"cfConnectingIp":"127.0.0.1","xForwardedFor":null,"userAgent":"Next.js Middleware","cookie":null}
SSR subrequest  {"cfConnectingIp":"127.0.0.1","xForwardedFor":null,"userAgent":"Next.js Middleware","cookie":null}
browser direct  {"cfConnectingIp":"203.0.113.11", ...}   <- per-visitor, honoured
```

Two distinct visitors produced identical subrequests. **Next builds a fresh `Request` and
forwards none of the incoming headers** — no cookie, no `Authorization`, not even the user
agent. What the Worker sees as `CF-Connecting-IP` is the socket peer of the SSR runtime.

So every server-rendered board and detail request shares **one** 60 req/min bucket. The
post-hydration client fetch, which leaves the browser directly, is metered correctly per
visitor. The path that shares the bucket is the anonymous, crawler-facing one — the path
the milestone exists to serve.

## What is and is not established

- **Established:** the application propagates no visitor identity on the SSR path. Any
  per-visitor metering of server-rendered traffic would have to be *built*, not configured.
- **Not established:** what Cloudflare sets for `CF-Connecting-IP` on a
  Pages-Function→Worker subrequest **in production**. The local probe cannot answer that,
  and the answer changes which fix is appropriate.

## First step: measure on staging, do not guess

`deploy-staging` has no branch condition and both deploy workflows expose
`workflow_dispatch`, so this is cheap to answer empirically before changing anything.

**Do not raise or remove the limit on a guess.** If production does propagate the visitor
IP, there is nothing to fix. If it does not, the honest options are:

1. **Exempt the SSR origin** — a shared secret header between the Pages Function and the
   Worker, with the limiter skipping requests that carry it. Keeps the limit meaningful for
   direct callers; adds a credential that must be provisioned per tenant.
2. **Move the limit to the edge** — a Cloudflare rate-limiting rule on the public routes,
   which sees the real client. Removes the application-level limiter's role for these
   routes entirely.
3. **Two budgets** — a tight per-IP limit for direct callers and a separate, much larger
   one for the SSR origin. Simplest, but the SSR budget is then effectively global and a
   single abusive visitor can exhaust it for everyone.

## Symptom, already mitigated

Milestone 20 Task 07 made a failed or rate-limited list render as **"unavailable"** rather
than as an empty board, so the failure no longer tells visitors the dojo has nothing
planned. That is cosmetic containment, not a fix.

## Acceptance Criteria

- [ ] `CF-Connecting-IP` as seen by the Worker for an SSR subrequest **on staging** is
      recorded in this file — the measurement, not an assumption.
- [ ] If it collapses: one of the three options above is chosen, with the reason written
      down, and implemented.
- [ ] A test or a documented probe pins the chosen behaviour, so a later framework upgrade
      that changes header forwarding does not silently re-open it.
- [ ] The public board survives a burst from many distinct visitors without any of them
      receiving `429` for another's traffic.
