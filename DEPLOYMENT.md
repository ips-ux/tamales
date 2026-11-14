# Deployment

The site is on Firebase Hosting. The API is 1 Cloudflare Worker (`worker/`, name `bbt-api`).
Firestore and Firebase Auth hold the data and the owner login. All services use a free tier.

## How a deploy occurs

A push to `main` starts `.github/workflows/deploy.yml`. You can also start it from the Actions tab.

1. It installs the site and the Worker dependencies.
2. It runs the site tests, the Worker type check and the Worker tests.
3. It builds the site with the `VITE_*` values.
4. It deploys the Worker with `npx wrangler deploy`. It skips this step if `CLOUDFLARE_API_TOKEN` is empty.
5. It deploys Hosting and the Firestore rules and indexes.

## First-time setup

Do these steps 1 time, in this sequence.

1. **Cloudflare account.** Create a free account. Add the site `bustostamales.com` and set the Cloudflare nameservers at the registrar.
2. **Domain to Firebase Hosting.** In the Firebase console, open Hosting and add the custom domains `bustostamales.com` and `www.bustostamales.com`. Add the records that Firebase shows to Cloudflare DNS. Set each record to "DNS only". Then open Authentication > Settings > Authorized domains and make sure the 2 domains are in the list.
3. **Email Routing.** In Cloudflare, open Email > Email Routing and enable it. Route `orders@bustostamales.com` to `banginbustostamales@gmail.com`. Add a catch-all rule to the same address.
4. **Resend.** Create a free Resend account. Add the domain `bustostamales.com`. Add the DNS records that Resend shows to Cloudflare DNS, then verify the domain. Create an API key with sending access.
5. **Turnstile.** In Cloudflare, open Turnstile and add a widget in Managed mode. Add the hostnames `bustostamales.com`, `www.bustostamales.com` and `bustostamale.web.app`. Keep the site key and the secret key.
6. **Worker.** Deploy the Worker and set its secrets (see below). Keep the Worker URL: `https://bbt-api.<your-subdomain>.workers.dev`.
7. **Cloudflare API token.** In Cloudflare, open My Profile > API Tokens. Create a token from the "Edit Cloudflare Workers" template. Copy the account ID from the Workers overview page.
8. **GitHub secrets.** Add the secrets in the table below. Then push to `main`.

### Worker deploy and secrets

Worker secrets are not in CI and not in the repository. Set each one with `wrangler secret put`. A secret stays set through later deploys.

```powershell
cd worker
npm install
npx wrangler login
npx wrangler deploy
Get-Content -Raw "C:\path\to\service-account.json" | npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

| Worker secret | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | The full service-account JSON. The account needs the "Cloud Datastore User" role. The Firebase Admin SDK key has it. |
| `RESEND_API_KEY` | The Resend API key. If it is empty, the Worker sends no email. |
| `TURNSTILE_SECRET_KEY` | The Turnstile secret key. If it is empty, the Worker does not verify Turnstile. Always set it in production. |

Values that are not secret are in `worker/wrangler.toml` under `[vars]`:

| Worker var | Default |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `bustostamale` |
| `PUBLIC_SITE_ORIGIN` | `https://bustostamales.com` |
| `ALLOWED_ORIGINS` | The 2 domain origins, `https://bustostamale.web.app`, and the 2 local development origins |
| `EMAIL_FROM` | `Bangin Bustos Tamales <orders@bustostamales.com>` |
| `OWNER_EMAIL` | `banginbustostamales@gmail.com` |

### GitHub Actions secrets

Add these in Settings > Secrets and variables > Actions.

| Secret | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNTS` | Full JSON of the deploy service account. It needs the roles "Firebase Hosting Admin", "Cloud Datastore Owner", "Firebase Rules Admin" and "Service Account User". |
| `VITE_FIREBASE_API_KEY` | Firebase web API key. |
| `VITE_FIREBASE_AUTH_DOMAIN` | `bustostamale.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `bustostamale` |
| `VITE_FIREBASE_APP_ID` | Firebase web app ID. |
| `VITE_API_BASE_URL` | The Worker URL, with no slash at the end. |
| `VITE_TURNSTILE_SITE_KEY` | The Turnstile site key. |
| `CLOUDFLARE_API_TOKEN` | The Cloudflare API token. If it is empty, CI does not deploy the Worker. |
| `CLOUDFLARE_ACCOUNT_ID` | The Cloudflare account ID. |

The `VITE_*` values are public. The browser bundle contains them.

## Local development

1. Copy `.dev.vars.example` to `.env.local`. Run `npm run firebase:env` to fill the Firebase values.
2. Copy `worker/.dev.vars.example` to `worker/.dev.vars` and fill it. Git ignores this file.
3. Run `npm --prefix worker install`, then `npm run worker:dev`. The Worker serves `http://127.0.0.1:8787`.
4. Run `npm run dev` for the site.

With no `TURNSTILE_SECRET_KEY`, the local Worker does not verify Turnstile. With no `RESEND_API_KEY`, it logs each email and does not send it.

## Manual deploy

```powershell
npm run worker:deploy
npm run deploy
```

`npm run deploy` builds the site, then deploys Hosting and the Firestore rules and indexes. It needs the Firebase CLI with a login.
`GET <Worker URL>/api/health` returns `{ "ok": true }` when the Worker runs.

## Limits

- Worker free tier: 100,000 requests each day.
- Resend free tier: 3,000 emails each month and 100 emails each day.
- Do not enable the Firebase Blaze plan. Do not add Cloud Functions.
