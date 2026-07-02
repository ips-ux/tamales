# Admin Setup

## Current Project

Firebase project: `bustostamale`

This project is Firebase/Google only:

- Firebase Hosting serves the React app.
- Firebase Hosting rewrites `/api/**` to a Firebase HTTPS Function.
- Firebase Auth handles customer and owner sign-in.
- Firebase custom claims mark owner/admin users.
- Firestore is accessed through the Firebase Admin SDK in Cloud Functions.

## Current Local Status

- A Firebase service-account JSON file is stored locally under `.secrets/`.
- `.secrets/` and common Firebase private-key filename patterns are ignored by git.
- A Firebase Web App named for Bangin Bustos Tamales has been created in `bustostamale`.
- `.env.local` has been generated with the `VITE_FIREBASE_*` values needed by the browser login.
- Admin login has been confirmed locally with a Firebase Auth user that has the `admin: true` custom claim.

## Create A Local Service Account Key

Firebase database secrets are deprecated. Use a Firebase Admin SDK service account for local setup scripts:

1. Open **Project settings** in the Firebase console.
2. Go to **Service accounts**.
3. Click **Generate new private key**.
4. Save the JSON file somewhere outside this repo.
5. Point local setup commands at it with `GOOGLE_APPLICATION_CREDENTIALS`.

## Create The Two Admin Accounts

Official reference: [Firebase Authentication web setup](https://firebase.google.com/docs/auth/web/start)

1. Open the Firebase console for `bustostamale`.
2. Go to **Build > Authentication**.
3. Enable **Email/Password** under sign-in providers.
4. Go to the **Users** tab.
5. Click **Add user**.
6. Create one email/password account for you.
7. Create one email/password account for him.

## Grant Admin Access

Firebase console can create users, but admin status should be assigned as a custom claim.

Official reference: [Firebase custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)

After both users exist, run this locally with a Firebase service account:

```bash
npm --prefix functions install
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\bustostamale-service-account.json
npm --prefix functions run set-admin -- your-email@example.com
npm --prefix functions run set-admin -- his-email@example.com
```

PowerShell version:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\bustostamale-service-account.json"
npm --prefix functions run set-admin -- "your-email@example.com"
npm --prefix functions run set-admin -- "his-email@example.com"
```

After claims are assigned, each admin should sign out and sign back in so their ID token refreshes.

The same service-account setup seeds initial Firestore content:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\bustostamale-service-account.json"
npm run seed
```

To fill the local browser login config from Firebase, run:

```powershell
npm run firebase:env
```

If the project does not have a Web App yet, run:

```powershell
npm run firebase:env:create
```

## How Admin Protection Works

- Public `/login` stays customer-facing.
- If the signed-in Firebase user has `admin: true`, the app routes them to `/admin`.
- Admin API requests include the Firebase ID token.
- Firebase Functions verify the token server-side.
- Admin endpoints reject users without the `admin: true` claim.

Do not rely on hidden buttons or client-only checks for admin security.

## Immediate Admin Backend

- `GET /api/admin/dashboard`
- `GET /api/admin/orders`
- `PATCH /api/admin/orders/:id`
- `GET /api/admin/menu`
- `POST /api/admin/menu`
- `PATCH /api/admin/menu/:id`
- `DELETE /api/admin/menu/:id`
- `GET /api/admin/availability`
- `GET /api/admin/vendor-sessions`
- `GET /api/admin/contacts`
- `GET /api/admin/payment-settings`
- `PATCH /api/admin/payment-settings`
- `GET /api/admin/exports/orders`

The React admin screen is mobile-first and visually scaffolded. Several admin views still use fixture-backed
local state in `src/pages/AdminPage.tsx`; the matching Firebase Function endpoints are ready to wire into those
views next.

## Payment Settings

Live POS supports:

- Cash App cashtag
- PayPal.Me name
- Venmo handle
- Zelle contact
- Apple Pay planned flag/note

Cash App, PayPal, and Venmo can be represented as QR targets. Zelle is bank-app specific, so the
QR currently encodes payment instructions instead of pretending there is one universal Zelle deep link.
Apple Pay requires merchant/payment processing setup before it should be enabled.
