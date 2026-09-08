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
| Local dev   | `http://localhost:8787/auth/google/callback` |
| Staging     | `https://api-staging.arenaquest.app/auth/google/callback` |
| Production  | `https://api.arenaquest.app/auth/google/callback` |

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
   GOOGLE_REDIRECT_URI=http://localhost:8787/auth/google/callback
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

1. `GET /auth/google` — should redirect to Google's OAuth consent screen.
2. Complete the consent flow — Google redirects back to `/auth/google/callback`.
3. The API should respond with a redirect to `<WEB_BASE_URL>/auth/callback?token=…`.

If the redirect URI in the request doesn't match the Console configuration, Google
returns `redirect_uri_mismatch` — double-check both the `GOOGLE_REDIRECT_URI` binding
and the Console's Authorised Redirect URI list.

---

## Drive access for the content importer (separate client)

The sign-in client above is deliberately **not** reused by
`scripts/content/import-media.mjs`. It requests `openid email profile` with no
`access_type=offline`, so it never receives a refresh token and holds no Drive
scope. Bulk content import needs its own credential:

| | Sign-in client | Importer client |
|---|---|---|
| Type | Web application | **Desktop app** |
| Scopes | `openid email profile` | `https://www.googleapis.com/auth/drive.readonly` |
| Grant | authorization code (per user) | refresh token (long-lived, one operator) |
| Redirect | `https://<apiHost>/auth/google/callback` | `http://127.0.0.1:<port>/callback` |
| Env vars | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `AQ_GDRIVE_CLIENT_ID` / `AQ_GDRIVE_CLIENT_SECRET` / `AQ_GDRIVE_REFRESH_TOKEN` |
| Lives in | Worker vars + secret | the operator's shell, never in the repo |

Setup:

1. Enable the **Google Drive API** on the project (the sign-in flow needs no
   extra APIs, so it is probably still off). Skipping this still lets `--login`
   succeed, but the first listing fails with `403 accessNotConfigured`.
2. Configure the **OAuth consent screen** (shown as *Google Auth Platform* in
   newer consoles): user type **External** for a personal Google account, app
   name, support email, developer contact. The scope does not need declaring —
   the script requests `drive.readonly` at runtime. Add the content owner as a
   test user.
3. **Publish the app.** This is the trap: an External consent screen left in
   **Testing** issues refresh tokens that **expire after 7 days**, so a long
   import campaign would need a fresh `--login` every week. `Publishing status →
   PUBLISH APP` removes that expiry.

   The app stays *unverified*, so consent shows the "Google hasn't verified this
   app" interstitial — proceed through *Advanced → Go to … (unsafe)*.
   `drive.readonly` is a restricted scope, and an unverified app serves up to 100
   users, which is ample for an operator importing their own content.
4. Create an OAuth client of type **Desktop app**. A desktop client accepts any
   loopback port, so there is no redirect URI to register.
5. Mint the refresh token once:

```bash
export AQ_GDRIVE_CLIENT_ID=...apps.googleusercontent.com
export AQ_GDRIVE_CLIENT_SECRET=...
node scripts/content/drive-source.mjs --login
```

`--login` prints the consent URL and then takes the result either way: it serves
the loopback callback for a browser on the same machine, and it also accepts the
callback URL pasted back into the prompt for a headless box. `--port <n>` pins
the loopback port when you would rather forward it
(`ssh -L 5555:localhost:5555 you@server`). The out-of-band flow Google retired in
2022 is not used and is not needed.

The token is printed once to stdout — handing it over is that command's entire
purpose. It is never written to disk, and the importer itself never logs it.
Revoke it at <https://myaccount.google.com/permissions> if it leaks.

See `docs/onboarding.md` for the import runbook.
