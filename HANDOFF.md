# Project Handoff

## Current State

Bangin Bustos Tamales is now a Firebase/Google-only React app with a public preorder site, customer-facing
member login, admin-gated owner area, and mobile-first Live POS scaffold.

Confirmed locally:

- Firebase Web App config was generated into `.env.local`.
- Firebase Auth login works.
- An admin user with the `admin: true` custom claim can reach `/admin`.
- The Firebase service-account key is stored locally under `.secrets/`.
- `.secrets/`, `.env.local`, build output, and common Firebase private-key filenames are ignored by git.

## Website Work Completed

- Updated the hero/media pipeline to use images from `public/media/`.
- Added design flair to the homepage hero while keeping the tamale brand visual-first.
- Added Login to the header navigation.
- Hid the hamburger menu on desktop.
- Added a customer-facing login page that routes admins to `/admin` after Firebase verification.

## Admin And POS Work Completed

- Added admin routes for Dashboard, Live POS, Orders, Menu, Availability, Vendor, Contacts, Settings, and Exports.
- Built a mobile-first Live POS screen with tap-to-add ticket building.
- Added payment-platform selection for Cash App, PayPal, Venmo, Zelle, and planned Apple Pay.
- Added QR rendering for external payment handoff.
- Added menu manager controls for name, ingredients, price, removal, and preorder-menu visibility.
- Added payment settings UI for owner-entered payment handles.

## Firebase Work Completed

- Added Firebase client Auth helper code for browser login.
- Added Firebase Hosting rewrite config for `/api/**` to the HTTPS Function named `api`.
- Added Firebase Functions API scaffold backed by the Firebase Admin SDK.
- Added Firestore rules that deny direct client access; server reads and writes through Admin SDK.
- Replaced manual Firestore REST/JWT seed logic with Firebase Admin SDK seeding.
- Added local setup helpers:
  - `npm run firebase:env`
  - `npm run firebase:env:create`
  - `npm run seed`
  - `npm --prefix functions run set-admin -- email@example.com`

## Important Workflow Notes

- The project owner starts local dev servers. Do not run `npm run dev` from automation unless the owner explicitly reverses that instruction.
- Do not add Cloudflare to the active implementation. Hosting, auth, database, and backend are Firebase/Google.
- Do not use deprecated Firebase database secrets. Use Firebase Admin SDK service accounts for local scripts.
- Keep Admin SDK JSON keys out of the repo.

## Codex Notes

- The latest verified direction is Firebase-only: Firebase Hosting, Auth, Functions, Firestore, and Admin SDK.
- The login problem was caused by missing browser-side Firebase Web App config, not the Admin SDK service-account JSON.
- A Firebase Web App has now been created for `bustostamale`, and `.env.local` was generated with the needed `VITE_FIREBASE_*` values.
- The Admin SDK service-account JSON belongs in `.secrets/`; it is for local scripts such as admin-claim setup and Firestore seeding.
- The owner/admin login path is intentionally customer-facing. Admin access is covertly determined by the Firebase `admin: true` custom claim after login.
- `/admin` is visually available and the login gate works, but much of `src/pages/AdminPage.tsx` still uses fixture-backed local state. The next backend pass should wire these views to `/api/admin/*`.
- Live POS currently creates an in-person ticket and QR payment handoff. It does not yet verify that Cash App, PayPal, Venmo, Zelle, or Apple Pay payment actually completed.
- Apple Pay should stay disabled until there is a real merchant/payment processor path.
- For future collaboration, do not start or restart the Vite dev server from Codex. The project owner will run local servers.

## Next Implementation Steps

- Wire `src/pages/AdminPage.tsx` to the live `/api/admin/*` endpoints instead of fixture-backed local state.
- Add loading, empty, and error states for live admin data.
- Add create/update/delete persistence for menu manager and payment settings from the admin UI.
- Add owner payment-confirmation workflow for POS orders, since QR handoff alone does not verify payment.
- Add App Check before public launch.
- Run mobile QA on iPhone and Android widths for `/admin/pos`, `/login`, `/order`, and the homepage.
