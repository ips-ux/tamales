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
| `PAYPAL_CLIENT_SECRET` | The secret of the PayPal REST app. If it is empty, the payment routes answer 503. See "PayPal Checkout". |

Values that are not secret are in `worker/wrangler.toml` under `[vars]`:

| Worker var | Default |
| --- | --- |
| `FIREBASE_PROJECT_ID` | `bustostamale` |
| `PUBLIC_SITE_ORIGIN` | `https://bustostamales.com` |
| `ALLOWED_ORIGINS` | The 2 domain origins, `https://bustostamale.web.app`, and the 2 local development origins |
| `EMAIL_FROM` | `Bangin Bustos Tamales <orders@bustostamales.com>` |
| `OWNER_EMAIL` | `banginbustostamales@gmail.com` |
| `PAYPAL_ENV` | `sandbox`. Set `live` for real payments. |
| `PAYPAL_CLIENT_ID` | Empty. The client ID of the PayPal REST app. |

`worker/wrangler.toml` also has a cron trigger. It runs the Worker each 5 minutes to expire orders that were not paid in time.

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
| `VITE_PAYPAL_CLIENT_ID` | The client ID of the PayPal REST app. It must be the same value as `PAYPAL_CLIENT_ID` in `worker/wrangler.toml`. |
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

## PayPal Checkout

PayPal has 2 environments. Sandbox uses test money. Live uses real money. Each one has its own client ID and secret.

1. Create a PayPal Business account with the owner's email address.
2. Log in at `https://developer.paypal.com`. Open Apps & Credentials.
3. Select Sandbox. Create a REST app. Copy the client ID and the secret.
4. Put the client ID in `PAYPAL_CLIENT_ID` in `worker/wrangler.toml`. Keep `PAYPAL_ENV = "sandbox"`.
5. In `worker/`, run `npx wrangler secret put PAYPAL_CLIENT_SECRET` and paste the secret.
6. Set the GitHub secret `VITE_PAYPAL_CLIENT_ID` to the same client ID.
7. Merge to `main`. Pay for 1 test order with a sandbox buyer account from the developer site.

To accept real payments, do steps 3 to 6 again with Live selected, and set `PAYPAL_ENV = "live"`.
Change the 3 values and the environment in 1 deploy. A sandbox ID with a live secret does not work.

The Worker does not send refunds. Send a refund in PayPal, then record it in Admin.

## Limits

- Worker free tier: 100,000 requests each day and 50 subrequests for each run. The expiry run takes 8 orders at most each 5 minutes.
- Resend free tier: 3,000 emails each month and 100 emails each day.
- Do not enable the Firebase Blaze plan. Do not add Cloud Functions.
