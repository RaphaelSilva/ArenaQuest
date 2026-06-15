# Google OAuth Setup Guide

This guide explains how to create a Google OAuth 2.0 client and configure the
required Worker bindings for each environment.

---

## 1. Create an OAuth 2.0 Client in Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select (or
   create) your project.
2. Navigate to **APIs & Services → Credentials**.
3. Click **Create Credentials → OAuth 2.0 Client ID**.
4. Choose **Web application** as the application type.
5. Set a recognisable name, e.g. `ArenaQuest – Local Dev`.

### Authorised Redirect URIs

Add one URI per environment:

| Environment | Redirect URI |
|-------------|--------------|
| Local dev   | `http://localhost:8787/v1/auth/google/callback` |
| Staging     | `https://api-staging.arenaquest.app/v1/auth/google/callback` |
| Production  | `https://api.arenaquest.app/v1/auth/google/callback` |

> You can create separate OAuth clients per environment (recommended) or a single
> client with all three redirect URIs listed.

6. Click **Create**. Google will show your **Client ID** and **Client Secret** — copy
   both.

---

## 2. Local Development Setup

1. Copy `.dev.vars.example` to `.dev.vars` (if you haven't already):
   ```bash
   cp apps/api/.dev.vars.example apps/api/.dev.vars
   ```

2. Fill in your credentials:
   ```
   GOOGLE_CLIENT_ID=<paste Client ID here>
   GOOGLE_CLIENT_SECRET=<paste Client Secret here>
   GOOGLE_REDIRECT_URI=http://localhost:8787/v1/auth/google/callback
   ```

3. Start the API:
   ```bash
   make dev-api
   ```

The `GOOGLE_REDIRECT_URI` value in `.dev.vars` must exactly match one of the
Authorised Redirect URIs configured in the Google Console.

---

## 3. Staging and Production Deployment

`GOOGLE_CLIENT_ID` and `GOOGLE_REDIRECT_URI` are plain vars already set in
`wrangler.jsonc` — update them with real values before deploying.

`GOOGLE_CLIENT_SECRET` is a Wrangler secret and must **never** appear in
`wrangler.jsonc` or any committed file. Set it once per environment:

```bash
# Staging
wrangler secret put GOOGLE_CLIENT_SECRET --env staging

# Production
wrangler secret put GOOGLE_CLIENT_SECRET
```

---

## 4. Required Google APIs

Ensure the following API is enabled in your Google Cloud project:

- **Google Identity (OAuth)** — enabled by default when you create OAuth credentials.

No additional APIs are required for the basic sign-in flow implemented in Task 08.

---

## 5. Verifying the Setup

After configuration, test the full flow:

1. `GET /v1/auth/google` — should redirect to Google's OAuth consent screen.
2. Complete the consent flow — Google redirects back to `/v1/auth/google/callback`.
3. The API should respond with a redirect to `<WEB_BASE_URL>/auth/callback?token=…`.

If the redirect URI in the request doesn't match the Console configuration, Google
returns `redirect_uri_mismatch` — double-check both the `GOOGLE_REDIRECT_URI` binding
and the Console's Authorised Redirect URI list.
