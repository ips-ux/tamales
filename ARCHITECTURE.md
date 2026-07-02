# Architecture

## Application Shape

The application is a React/Vite frontend deployed to Firebase Hosting. Firebase Hosting rewrites
`/api/**` to a Firebase HTTPS Function. Firestore stores business data, and Firebase Auth handles
customer/member login plus owner/admin access through custom claims.

## Frontend

- `src/pages/HomePage.tsx`: branded homepage and menu preview
- `src/pages/LoginPage.tsx`: customer-facing member login entry and admin-claim routing
- `src/pages/OrderPage.tsx`: six-part order request flow
- `src/pages/ConfirmationPage.tsx`: public token confirmation view
- `src/pages/VendorPage.tsx`: vendor kiosk, QR, and waitlist capture
- `src/pages/AdminPage.tsx`: owner dashboard, mobile-first Live POS, menu manager, payment settings, contacts, exports
- `src/components/AdminGate.tsx`: Firebase Auth custom-claim admin gate
- `src/components/SiteHeader.tsx`: responsive header with desktop links and mobile menu control
- `src/lib/firebaseClient.ts`: Firebase client Auth helpers

The homepage hero uses the real media placeholders in `public/media/`. Admin screens are designed mobile-first,
especially `/admin/pos`, but the React admin page currently reads fixture data and local component state for some
owner workflows. The matching Firebase Function endpoints exist and should be connected as the next backend pass.

## Firebase Functions

Firebase Function source lives in `functions/src/index.ts`.

Public APIs:

- `GET /api/public/business`
- `GET /api/public/menu`
- `GET /api/public/availability`
- `POST /api/public/orders`
- `GET /api/public/orders/:publicToken`
- `POST /api/public/contacts`
- `GET /api/public/vendor/:sessionToken`

Admin APIs:

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

Setup scripts:

- `functions/scripts/set-admin-claim.mjs`: grants `admin: true` to an existing Firebase Auth user.
- `functions/scripts/seed-firestore.mjs`: seeds Firestore through the Firebase Admin SDK.
- `functions/scripts/write-web-env.mjs`: reads the Firebase Web App config and writes local `.env.local`.

## Data Rules

- Store money as integer cents.
- Store timestamps as UTC ISO strings or Firestore timestamps normalized to ISO strings in API responses.
- Present dates in `America/Denver`.
- Store product and price snapshots on every order item.
- Use `publicToken` for customer confirmations, never internal order IDs.
- Keep private owner notes off public responses.

## Auth Boundary

Firebase Auth is the only account system. Customer accounts and owner accounts use the same public `/login`
surface. Admin authorization is determined by verified Firebase ID token custom claims, checked by Firebase
Functions before privileged work.

## Deployment Boundary

This app is Firebase/Google only. Do not add Cloudflare Access, Workers, or database secrets to the active
implementation. Deployed Functions use Google-managed runtime credentials via `initializeApp()`. Local setup
scripts use a Firebase Admin SDK service account from `.secrets/` or `GOOGLE_APPLICATION_CREDENTIALS`.
