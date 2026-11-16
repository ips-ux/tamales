# Agent Changelog

Technical log for coding agents. The newest entry is first.
Each entry has a date (YYYY-MM-DD), a short title, and 5 fields: Changed, Why, Decisions, Verify, Next.
"Decisions" lists what a later agent must not undo. "Verify" says how the work was checked, or that it was not.
Work that is not merged to `main` stays in "Unreleased". Move the entry to "Released" when the pull request merges.
Add a matching plain-language entry to `USER_changelog.md` in the same change.

## Standing decisions

Agreed on 2026-11-13 by the developer and the owner. Do not change these without the developer's approval.

- One Cloudflare Worker (`worker/`) is the only door for public writes: orders, contact, waitlist, signups.
- The browser reads the menu and events from Firestore directly. Hosting stays on Firebase.
- No Cloud Functions and no Firebase Blaze plan. Build piece 1 deletes the `functions/` Cloud Functions code.
- No EmailJS and no fallback. The Worker sends email through the Resend free tier.
- Fixed cost is $0. The domain is the only fixed spend. PayPal takes a fee on each sale.
- Pre-orders and batch requests are prepaid through PayPal Checkout only. The Worker verifies each payment.
- Each customer order requires first name, last name and email. A POS walk-up sale does not require a name.
- Real sales are never deleted or silently edited. A correction is a void entry or a refund entry.
- The Instagram link stays as a `#` placeholder until a handle exists. Do not hide the link.
- The site makes no licensing or inspection claims. It shows a plain allergen notice.
- The owner's address is never shown publicly. The exact pickup address appears only in the confirmation after payment.
- Later, not V1: customer accounts, rewards, driver login, SMS, automatic backups, PayPal refunds from admin, Square.

## Unreleased

### 2026-11-15 - Build piece 3: Money

- **Changed:**
  - Contract: `shared/moneyModel.ts` (payment routes, `OrderSaleFields`, `LedgerEntry`, refund). New money fields on `OrderRecord`, fee settings on `OrderingSettings`.
  - Worker: `paypal.ts`, `payments.ts` (`POST /api/v1/payments/create` and `/capture`), `expiry.ts` (cron `*/5 * * * *`), `sale.ts` (handover writes `posTickets/{orderId}` and moves inventory), `refund.ts` (`POST /api/admin/orders/refund`).
  - A fixed-allotment pre-order now starts `approved` with a hold of `holdMinutes`. A pre-order and a batch request always use PayPal Checkout and carry the online ordering fee.
  - Site: PayPal buttons and countdown on the tracker, "PayPal or card" for live orders, fee line in the order flow, refund dialog, Payment settings, POS sales list without delete or silent edit, reports rebuilt on the ledger.
  - Rules: `ledgerEntries` is owner read and create only. A `posTickets` delete needs `isTest == true`.
- **Why:** Piece 3 of the V1 plan: paid pre-orders and books that keep every change.
- **Decisions:**
  - An order is paid only on a verified `COMPLETED` PayPal capture in USD for the exact total, or when the owner marks it paid.
  - The Worker moves no refund money. The owner sends it, then records it.
  - An order must be paid before handover.
  - Reports count a sale at its first recorded amount and count each ledger entry in its own period. A refund before handover does not reduce sales, because no sale exists yet.
  - The expiry run handles 8 orders for each run, to stay under the free plan limit of 50 subrequests.
  - The PayPal `invoice_id` is the order number plus 8 characters of the order id, so it is unique.
  - The kiosk does not offer PayPal for live orders.
- **Verify:** `npm run build` passes. Site tests: 209 pass. Worker tests: 216 pass. Worker type check and `wrangler deploy --dry-run` pass. Not verified: every PayPal request and response shape, the PayPal JS buttons, `application_context.shipping_preference`, Firestore `:runQuery`, the cron trigger, the rules in an emulator, any screen in a browser.
- **Next:** Do not merge before PayPal is configured: without `PAYPAL_CLIENT_ID`, pre-orders cannot be paid and fixed-allotment holds expire. Set up the PayPal sandbox, run 1 test payment, then merge. Confirm the PayPal fee rate and the PayPal rules on a fee that a seller adds.

### 2026-11-15 - Fix: Worker could not reach Firestore

- **Changed:** `worker/src/firestore.ts` wraps the global `fetch` in its default `fetchFn`. New test `worker/test/fetchReceiver.test.ts`.
- **Why:** The class called `this.fetchFn(...)`, so the global `fetch` ran with the class as its receiver. Workers throw "Illegal invocation" for that. Every route that reads or writes Firestore failed with HTTP 500 in production since piece 1. Unit tests did not see it, because they inject a stub `fetch`.
- **Decisions:** Never store the global `fetch` as a method and call it through `this`. Wrap it in an arrow function.
- **Verify:** The new test fails on the old code with "Illegal invocation" and passes on the fix. Worker tests: 155 pass. Live check after deploy: see the next entry or the pull request.
- **Next:** Send 1 real contact message and 1 real order from the live site.

### 2026-11-14 - Build piece 2: Events and ordering

- **Changed:**
  - New `shared/`: the V1 order model (`model.ts`) and pure rules for pricing, quantity labels, order numbers, delivery rings, order states and events. The site and the Worker both import it.
  - Worker: `POST /api/v1/orders`, `/api/v1/delivery-quote`, `/api/v1/waitlist`, `/api/admin/orders/action`. Firestore transactions issue order numbers and change fixed allotments. Order emails. The old `POST /api/orders` and `worker/src/orders.ts` are deleted.
  - Customer site: `/order` (pre-orders and Request a Batch), `/e/{eventId}` (mobile ordering at an event), `/t/{trackerToken}` (order tracker with alerts and payment help), `/kiosk/{kioskToken}` (kiosk with exit PIN and waitlist). Home shows the next event and a "Track your order" link.
  - Admin: Events area (replaces Availability and Vendor) with kiosk and mobile links, printable QR codes, prep sheet and pickup list. New Pre-Orders queue. Live orders in Live POS with a chime, a badge, a pause switch and sold-out toggles. Settings, Ordering tab. Waitlist card in Contacts.
  - Removed: the old order model (`availabilityWindows`, `pickupLocations`, `vendorSessions`, the confirmation page, `VendorPage`), and Zelle, Apple Pay and PayPal.Me from the POS.
  - Rules: `orders` is owner read only. New `events`, `eventStock`, `eventPrivate`, `trackers`, `waitlist`, `counters`, `settings/ordering`, `settings/orderingPrivate`. `settings/payments` is public read.
- **Why:** Piece 2 of the V1 plan.
- **Decisions:**
  - The browser never writes an order. Every order change goes through the Worker, which checks the state table in `shared/orderState.ts`.
  - A tracker document holds no email, phone or street address. The exact pickup address goes only in the paid email.
  - `OrderRecord.stockHeld` records that an order took tamales from `eventStock`. Cancel returns them.
  - `idempotencyKey` on `/api/v1/orders` makes a double submit return the first order. The order id is `sha256("order:{email}:{key}")`.
  - "Pause mobile orders" also pauses the kiosk.
  - POS sales keep the `POS-…` number. Only mobile and kiosk orders use `#N - Date - Name`.
  - Fixed-allotment pre-orders are accepted without payment until piece 3 adds PayPal Checkout.
- **Verify:** `npm run build` passes. Site tests: 169 pass. Worker tests: 154 pass. Worker type check and `wrangler deploy --dry-run` pass. Not verified: any screen in a browser; Web Audio, vibration, wake lock and clipboard on real phones; Firestore transactions, the Census geocoder and the rules against the real services.
- **Next:** Piece 3, Money: PayPal Checkout, the online ordering fee, the 72-hour payment limit, one sales ledger, refunds.

### 2026-11-13 - Account setup for production

- **Changed:** No code. Accounts only, all under `banginbustostamales@gmail.com`.
  - Cloudflare: Email Routing sends `orders@bustostamales.com` to the owner's Gmail. Turnstile widget "Bangin Bustos site forms" covers `bustostamales.com` and `bustostamale.web.app`.
  - Cloudflare DNS: A record and TXT record for Firebase Hosting; Resend records `resend._domainkey`, `rsend`, `send`, `_dmarc`. All are "DNS only".
  - Firebase: the owner's Gmail is invited as Owner. `bustostamales.com` is a Hosting custom domain and an authorized Auth domain.
  - Resend: domain `bustostamales.com` is verified.
  - Worker `bbt-api` is deployed at `https://bbt-api.bbt-api.workers.dev` with its 3 secrets set.
- **Why:** Piece 1 needs real accounts before it can send email or accept a form.
- **Decisions:** Resend DNS was set by hand; Resend has no access to the Cloudflare account. Cloudflare Email Sending needs the paid Workers plan, so Resend stays. The Resend receiving MX record was not added, because Cloudflare Email Routing owns inbound mail.
- **Verify:** Worker `GET /api/health` returns 200. A POST with no Turnstile token gets 400, a POST from an unknown origin gets 403, and `/api/receipts` with no token gets 401. Not verified: a write to Firestore and a sent email, because both need a real form submit from the deployed site.
- **Next:** Add GitHub secrets `VITE_API_BASE_URL`, `VITE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. Add `www.bustostamales.com`. Merge to `main`, then send 1 contact message as the end-to-end test.

### 2026-11-13 - Build piece 1: Foundation

- **Changed:**
  - New `worker/`: Cloudflare Worker `bbt-api` with `POST /api/contact`, `/api/signup`, `/api/orders`, `/api/receipts` and `GET /api/health`. It uses the Firestore REST API with a service-account token, Resend for email, Turnstile and a honeypot. It has 0 runtime dependencies.
  - New `src/lib/api.ts` (the HTTP contract) and `src/lib/siteContent.ts` (owner text and photos with defaults).
  - Public site: Contact page, footer, 404 page, new Privacy and Terms, new Home and About copy, icons, share image, `robots.txt`. All public forms send through the Worker.
  - Admin: Site Content editor at `/admin/content`, contact messages with an unread badge, POS receipt through the Worker.
  - `firebase/firestore.rules`: public creates closed on `orders` and `marketingSignups`. Added `siteContent`, `siteImages`, `contactMessages`, `customers`.
  - Removed `functions/`, `src/lib/emailReceipt.ts` (EmailJS), the seed script and `firebase/firestore.seed.json`. Admin scripts moved to `scripts/`.
  - `.github/workflows/deploy.yml`: runs both test sets, deploys the Worker if `CLOUDFLARE_API_TOKEN` exists.
  - `README.md`, `DEPLOYMENT.md` and `ADMIN_SETUP.md` rewritten.
- **Why:** V1 needs 1 server for public writes and email before events, orders and payments can be built.
- **Decisions:**
  - The Worker does not trust totals, status or order numbers from the browser. It reads prices and the tax rate from Firestore.
  - A filled honeypot gets `{ ok: true }` with no data, and nothing is saved.
  - New public CSS goes in `src/styles/public.css`. New admin CSS goes in `src/styles/admin-content.css`.
  - `orders` keeps a public `get` by token until piece 2 adds `trackers`.
  - `/api/orders` keeps the old order model and a random `BBT-<year>-<5 characters>` number. Piece 2 replaces both.
- **Verify:** `npm run build` passes. Site tests: 32 pass. Worker tests: 76 pass. Worker type check passes. `wrangler deploy --dry-run` passes. Not verified: real calls to Firestore, Resend, Turnstile and Google keys; the rules in an emulator; any screen in a browser.
- **Next:** Account setup in the browser (Cloudflare DNS, Email Routing, Resend, Turnstile, Worker secrets, GitHub secrets). Then piece 2. Known gaps: no rate limit and no idempotency on the Worker; the 2 logo files are large; the 404 page returns HTTP 200.

### 2026-11-13 - Project records established

- **Changed:** Added `AGENT_changelog.md`, `USER_changelog.md` and `CLAUDE.md`. Added an out-of-date notice to the top of `ARCHITECTURE.md`, `HANDOFF.md`, `SECURITY.md`, `BanginBustosTamalesPlan.md`, `DEPLOYMENT.md`, `ADMIN_SETUP.md` and `README.md`. `docs/V1_FUNDAMENTALS.md` and `docs/V1_DESIGN.md` are written in the same change set.
- **Why:** The old root docs describe Cloud Functions as the backend and forbid Cloudflare. The V1 design reverses both.
- **Decisions:** The 2 V1 docs are the source of truth. Each change to behavior, data or content adds 1 entry to both changelogs. All text follows ASD-STE100 as `docs/V1_DESIGN.md` defines it.
- **Verify:** Documentation only. No source code changed. `npm run build` and `npm test` were not run.
- **Next:** Start build piece 1, Foundation. It must move the admin scripts out of `functions/scripts/` and correct the `package.json` commands that call `functions/`.

### 2026-11-13 - V1 design agreed

- **Changed:** Nothing is built yet. This entry records the agreed design only.
- **Why:** The developer and the owner agreed the production V1 design in 1 session. Production holds no real data, so the schema and rules start clean.
- **Decisions:**
  - Architecture: React and Vite on Firebase Hosting, Firestore, Firebase Auth with the `admin: true` claim, and 1 Cloudflare Worker. Domain is `bustostamales.com`. Turnstile protects public forms. Cloudflare Email Routing forwards inbound mail to the owner's Gmail.
  - Event pre-order has 2 modes. Fixed allotment counts individual tamales, accepts automatically, takes payment at checkout and holds stock for 15 minutes. Open interest needs the owner to approve or decline.
  - A batch request has no event. It uses pickup or delivery, and the owner approves or declines it. An approved order has 72 hours to pay (adjustable), then it cancels automatically.
  - The PayPal fee is split 50/50 with the customer as an "Online ordering fee" line. The line appears on PayPal Checkout orders only.
  - A live order (mobile QR, kiosk, POS) accepts PayPal Checkout, a Venmo link, a Cash App link or cash. An order without PayPal Checkout shows "check payment". Live orders open only during event hours. Each item can be sold out. A "Pause mobile orders" switch exists.
  - Order numbers: a live order uses `#N - Date - First Last` and restarts each event day. A pre-order or batch request uses a running `BBT-####`.
  - Quantities show as a number with the common term: "12 (1 dozen)".
  - The tracker shows live status with a chime, a flash, a wake lock and vibration (Android only). A "ready" email links to the tracker.
  - Delivery: on/off switches for pickup and delivery, a private start address, radius rings with fees (straight-line distance, US Census geocoder), and an owner fee override.
  - Marketing opt-in is unchecked by default. If the customer leaves it unchecked, a "Heads up!" prompt shows.
  - The kiosk is required for V1: real events in admin, a kiosk link and QR, an exit PIN, a saved waitlist, a prep sheet and a pickup list for each event.
  - Admin "Site Content" editor covers hero, About, How It Works, policies, allergen notice and footer text. Layout, colors, fonts, logo and legal text are fixed. Site images are stored in Firestore documents (about 250 KB each) in fixed slots.
  - Accounting: a prepayment is a deposit until handover. Tax is a liability. Fees are expenses. The owner sends a refund in the payment app, then records it in admin.
  - Backup: a "Back Up & Open Admin" screen shows on the first admin visit each week and cannot be skipped. It saves to the owner's Google Drive and keeps 30 backups. Live POS is exempt.
  - Orders are keyed to a customer record by email, so customer accounts can attach later.
- **Verify:** Not applicable. No code exists for this design.
- **Next:** Build in 4 pieces, 1 pull request each: 1 Foundation, 2 Events and ordering, 3 Money, 4 Backups. No event deadline applies.

## Released

No entries yet.
