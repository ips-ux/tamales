# Deployment

The app is hosted on **Firebase** (Hosting + Functions + Firestore + Auth). GitHub
holds the source and runs the deploy. GitHub Pages is **not** used: it can only serve
static files and cannot run the `/api/**` Cloud Function that the order flow depends on.

## How deploys happen

Every push to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which:

1. Installs dependencies for the app and `functions/`.
2. Builds the Vite frontend (injecting the `VITE_FIREBASE_*` browser config).
3. Builds the Functions TypeScript.
4. Runs `firebase deploy --only hosting,firestore,functions` against the
   `bustostamale` project.

You can also run it on demand from the repo's **Actions** tab (**Run workflow**), or
deploy from your machine with `npm run deploy`.

## Required GitHub Actions secrets

Add these under **Settings → Secrets and variables → Actions → New repository secret**.
Nothing here should ever be committed to the repo.

| Secret | Value | Where to get it |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNTS` | Full JSON of a deploy service account | See below |
| `VITE_FIREBASE_API_KEY` | Web API key | Firebase Console → Project settings → General → Your apps (Web) |
| `VITE_FIREBASE_AUTH_DOMAIN` | `bustostamale.firebaseapp.com` | Same place (or your local `.env.local`) |
| `VITE_FIREBASE_PROJECT_ID` | `bustostamale` | Same place |
| `VITE_FIREBASE_APP_ID` | Web app ID | Same place |

The `VITE_*` values are the same ones already in your local `.env.local`. They are
public browser config (they ship inside the client bundle regardless), so they are not
sensitive — they live in secrets only so the repo stays env-file-free.

## Creating the deploy service account

The CI job authenticates as a Google service account. Create one with permission to
deploy Hosting, Firestore, and Functions:

1. In the [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
   for the `bustostamale` project, create a service account named e.g. `github-deployer`.
2. Grant it these roles:
   - **Firebase Hosting Admin**
   - **Cloud Functions Admin**
   - **Cloud Datastore Owner** (Firestore rules/indexes)
   - **Service Account User**
   - **Firebase Authentication Admin** (only if the deploy touches Auth config)
3. Create a JSON key for it and paste the entire file contents into the
   `FIREBASE_SERVICE_ACCOUNT` secret.

> Shortcut: running `firebase init hosting:github` locally will auto-provision a
> least-privilege service account and store it as a repo secret for you. If you use
> that path, point this workflow's secret name at the one it creates (or copy the JSON
> into `FIREBASE_SERVICE_ACCOUNT`). Note that it scaffolds a **hosting-only** workflow,
> so keep this one for the full Hosting + Functions + Firestore deploy.

The existing Admin SDK key in `.secrets/` is meant for local admin scripts (seeding,
setting admin claims). You can reuse it for CI if its role can deploy, but a dedicated
`github-deployer` account is cleaner and easier to revoke.

## Current state: free (Spark) plan

The project is currently on the free Spark plan, which cannot deploy Cloud Functions.
CI therefore deploys **Hosting + Firestore rules/indexes only**. Two things are
intentionally parked until Blaze:

1. `.github/workflows/deploy.yml` deploys `--only hosting,firestore` (no `functions`).
2. `firebase.json` has the `/api/**` → `api` function rewrite removed, because Hosting
   deploys fail if a rewrite targets a function that does not exist in the project.

Consequence: the public site, login, and static pages work, but anything that calls
`/api/**` (order submission, live admin data) is offline until Blaze is enabled.

### Switching the backend on (Blaze)

When the owner enables Blaze (Firebase Console → Settings → Usage and billing):

1. Restore the rewrite in `firebase.json` (above the SPA catch-all):
   ```json
   { "source": "/api/**", "function": "api" }
   ```
2. In the workflow's deploy step, change `--only hosting,firestore` to
   `--only hosting,firestore,functions`.
3. Push to `main`; set a **budget alert** ($5–10) in Google Cloud Billing.

At this app's traffic, Blaze's pay-as-you-go pricing still includes the free-tier
allowances (2M function invocations/month, Firestore free quotas), so the realistic
monthly cost is $0 to pocket change — but the alert catches surprises.

## Notes

- Firebase Hosting's default domains (`bustostamale.web.app`,
  `bustostamale.firebaseapp.com`) are automatically authorized for Firebase Auth, so no
  extra "authorized domains" configuration is needed for this hosting path.

## Manual deploy from a workstation

```powershell
npm run deploy
```

This runs `npm run build`, builds functions, and runs `firebase deploy`. Requires the
Firebase CLI logged in (`firebase login`) or `GOOGLE_APPLICATION_CREDENTIALS` pointed at
a service-account key.
