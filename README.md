# Bangin Bustos Tamales

A mobile-first preorder, owner dashboard, and vendor POS platform for a single tamale business.
The app is Firebase/Google only: Firebase Hosting, Firebase Auth, Firebase Functions, and Firestore.

## Current Scope

- Public routes: `/`, `/order`, `/order/confirmation/:publicToken`, `/about`, `/login`, `/vendor/:sessionToken`, `/privacy`, `/terms`
- Admin routes: `/admin`, `/admin/pos`, `/admin/orders`, `/admin/menu`, `/admin/availability`, `/admin/vendor`, `/admin/contacts`, `/admin/settings`, `/admin/exports`
- Firebase Auth customer-facing login with admin custom-claim routing
- Header navigation includes Place an Order, About Me, and Login; the hamburger menu is hidden on desktop
- Firebase HTTPS Function for `/api/**`
- Firestore schema notes, rules, indexes, and seed data
- Mobile-first admin Live POS, menu manager, and payment settings scaffolding
- Current media files are `tamales_hero.png`, `chile_red.png`, and `pork_green.png` in `public/media/`

## Local Development

```bash
npm install
npm --prefix functions install
npm run dev
```

The Vite dev server runs the React app. Firebase Hosting serves the production build and rewrites
`/api/**` to the Firebase Function named `api`.

Project workflow note: the project owner starts local dev servers during collaborative sessions.

## Environment Variables

Copy `.dev.vars.example` to a local env reference and add the Vite Firebase values to your local shell
or `.env.local`. Never commit real secrets.

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

Firebase Functions use Google application credentials locally and Firebase runtime credentials in production.
The local service-account key belongs in `.secrets/`, which is ignored by git.

If a service-account key is available in `.secrets/`, this helper writes the local Firebase Web App
values required by the browser login:

```powershell
npm run firebase:env
```

If the Firebase project does not have a Web App yet, create one and write `.env.local` in one step:

```powershell
npm run firebase:env:create
```

The `bustostamale` project now has a Firebase Web App registered, and local login config has been written
to `.env.local` on this machine. Re-run `npm run firebase:env` if that file is deleted or regenerated elsewhere.

## Firebase Setup

1. Confirm `.firebaserc` points to `bustostamale`.
2. Enable Firestore.
3. Enable Firebase Authentication with Email/Password.
4. Create the two admin users in Authentication.
5. Grant admin custom claims with `npm --prefix functions run set-admin -- email@example.com`.
6. Review `firebase/schema.md`.
7. Deploy rules and indexes with the Firebase CLI.
8. Download a Firebase service-account key from **Project settings > Service accounts** and save it outside the repo.
9. Seed initial content with the Admin SDK:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\bustostamale-service-account.json"
npm run seed
```

You can also set `FIREBASE_SERVICE_ACCOUNT_JSON` to the full JSON payload in environments where file paths are awkward.
Do not use Firebase database secrets; they are deprecated and this project uses the Firebase Admin SDK instead.

Admin account setup notes live in `ADMIN_SETUP.md`.

## Current Handoff

See `HANDOFF.md` for the latest project state, finished work, Codex notes, and next implementation steps.

## Firebase Deployment

```bash
npm run deploy
```

This builds the Vite app, builds Firebase Functions, and deploys Hosting, Functions, Firestore rules,
and indexes through Firebase.

## Testing

```bash
npm run typecheck
npm run test
npm run build
npm --prefix functions run build
```

Responsive QA should cover 320px, 360px, 390px, tablet portrait, tablet landscape, laptop, and wide desktop.
The Live POS is mobile-first and should be tested on iPhone and Android widths before launch.

## Backup And Export

Owner-facing CSV export is scaffolded at `/api/admin/exports/orders`. For Firestore backups, schedule a
Google Cloud export to a private storage bucket and document the retention period for completed orders,
canceled orders, contact submissions, and logs.

## Media

Food images live in `public/media/`. Replace the current image files with real photography using
the same filenames, or update the menu item `imageUrl` values in Firestore.
