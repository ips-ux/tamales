# V1 Fundamentals

This document defines the functions of V1 of the Bangin Bustos Tamales web application.
The owner and the developer agreed on these functions on 2026-11-13.
If this document and an older root document disagree, this document is correct.

Each area has a status:

| Status | Meaning |
|---|---|
| Exists | The current code does this. Keep the behavior. |
| Changes | The current code does part of this. Change it to agree with this document. |
| New | The current code does not do this. |

## 1. Glossary

Use each term with this meaning only.
For the words that a customer sees, use section 4 of [V1_DESIGN.md](./V1_DESIGN.md).

| Term | Meaning |
|---|---|
| Owner | The person who operates the business and signs in to the admin area. |
| Customer | A person who buys or requests tamales. |
| Worker | The one Cloudflare Worker in `worker/`. It is the only server of the application. |
| Event | A dated sale at a location, with start and end hours. The owner creates it in admin. |
| Live order | An order that a customer places during event hours for handover at that event. |
| POS sale | A sale that the owner records on the Live POS screen. |
| Pre-order | An order that a customer places before an event for pickup at that event. |
| Fixed allotment | A pre-order mode. The event has a fixed count of tamales that customers can buy. |
| Open interest | A pre-order mode. The owner approves or declines each pre-order. |
| Batch request | A request for tamales with no event. The owner approves or declines it. |
| Kiosk | A tablet page at an event that customers use to order or to join the waitlist. |
| Waitlist | The list of persons who selected "Join the Next Batch". |
| Tracker | The public page that shows the status of one order. |
| Hold | A 15-minute reservation of fixed-allotment tamales during checkout. |
| Handover | The moment the customer receives the order. |
| PayPal Checkout | The PayPal payment flow that the Worker creates and verifies. |
| Payment link | A Venmo link or a Cash App link. The application cannot verify these payments. |
| Online ordering fee | The customer share of the PayPal fee, shown as one line on the order. |

## 2. Scope

V1 includes these functions:

- A public site with a menu, an About page, events, and policies.
- Live orders from a phone, from the kiosk, and from the Live POS screen.
- Pre-orders for events in 2 modes.
- Batch requests with pickup or delivery.
- Payment by PayPal Checkout, payment link, or cash.
- A tracker for each customer order.
- Email to the customer and to the owner.
- An admin area for events, orders, menu, site content, contacts, settings, reports, and backup.

V1 does not include these functions:

- Customer accounts and rewards.
- A driver login.
- SMS messages.
- Automatic backups.
- PayPal refunds from admin.
- Square.
- Edits to layout, colors, fonts, logo, or legal pages from admin.
- Claims about licenses or inspections on the site.

The fixed monthly cost must stay at $0.
The Firebase project stays on the free Spark plan.

## 3. System overview

```
Customer browser ──read──▶ Firestore (menu, events, locations, business settings, site content, tracker)
Customer browser ──write─▶ Worker ──▶ Firestore (service-account key)
                              ├────▶ PayPal (create order, verify payment)
                              ├────▶ Resend (send email)
                              └────▶ US Census geocoder (delivery address)
Owner browser ───read/write─▶ Firestore (admin claim)
Owner browser ───────────────▶ Google Drive (backup, owner approval)
Firebase Hosting serves the React application at bustostamales.com.
```

| Part | Status | Function |
|---|---|---|
| Firebase Hosting | Exists | Serves the React and Vite application. |
| Firestore direct reads | Exists | The browser reads public data without the Worker. |
| Firestore direct public writes | Changes | Today the browser creates `orders` and `marketingSignups`. V1 closes all public writes. |
| Firestore owner access | Exists | The owner reads and writes from the browser with the `admin` claim. |
| Worker | New | Receives every public write. Holds the Firebase service-account key and the Resend and PayPal secrets. |
| Resend | New | Sends email from the domain. Free tier: 3,000 emails per month, 100 emails per day. |
| Cloudflare Email Routing | New | Sends inbound domain email to banginbustostamales@gmail.com. |
| Cloudflare Turnstile | New | Protects public forms from automated use. |
| EmailJS (`src/lib/emailReceipt.ts`) | Changes | Remove it. Resend replaces it. There is no fallback. |
| Cloud Functions (`functions/`) | Changes | Delete the code. The deploy workflow does not deploy it. |
| Deploy workflow (`.github/workflows/deploy.yml`) | Changes | Remove the functions steps and the debug step. Add a Worker deployment. |

The Worker free tier permits 100,000 requests per day.
The Worker does these tasks:

- It validates each public request.
- It computes prices, totals, fees, and tax. It ignores totals that the browser sends.
- It enforces each fixed allotment. Two customers cannot buy the same last tamales.
- It issues order numbers.
- It creates and verifies PayPal Checkout payments.
- It sends all email.
- It cancels expired holds and unpaid approved orders.

The application protects public forms in these ways (status: New):

- Each public form includes a Cloudflare Turnstile check. The Worker verifies the token.
- Each public form includes a hidden honeypot field. The Worker rejects a request that fills it.
- The Worker validates the type, length, and format of every field.
- The Worker reads prices from Firestore. It does not accept a price from the browser.
- Firestore rules deny every public write.
- Public reads stay direct for the menu, events, locations, business settings, and site content.

Production has no real data. Implementers can replace the schema and the rules without a migration.

## 4. Roles

| Role | Status | Access |
|---|---|---|
| Owner | Exists | Full admin access. Firebase Auth account with the `admin: true` custom claim. |
| Employee | Exists | Same access as the owner. The owner creates the account with a temporary password. The first sign-in forces a password change. |
| Customer | Exists | No account. The customer uses public pages only. |
| Customer account | Later | Not in V1. Orders link to a customer record by email so that an account can attach later. |
| Driver | Later | Not in V1. |

## 5. Order types

V1 has 5 order types.
Every customer order requires a first name, a last name, and an email address.
A POS sale does not require a name.

| Type | Status | Source | Acceptance | Payment |
|---|---|---|---|---|
| POS sale | Exists | Live POS screen | Immediate | Cash or a payment method on the POS screen |
| Live order | New | Mobile QR page or kiosk | Automatic during event hours | PayPal Checkout, payment link, or cash |
| Pre-order, fixed allotment | New | `/order`, event selected | Automatic while tamales remain | PayPal Checkout at checkout |
| Pre-order, open interest | Changes | `/order`, event selected | Owner approves or declines | PayPal Checkout after approval |
| Batch request | New | `/order`, no event | Owner approves or declines | PayPal Checkout after approval |

Current state: `/order` creates one type of order with status `new`, and the owner confirms it in admin.
The current form requires one name field and a mobile number.

Rules for all customer orders:

- Show a quantity as a number with the common term, for example "12 (1 dozen)".
- Show the marketing opt-in unchecked.
- If the customer leaves the opt-in unchecked, show one "Heads up!" popup before submit.
- Show the exact pickup address only in the confirmation after payment.

### POS sale

The Live POS screen stays as it is, with these changes:

- The Worker sends the receipt email. The receipt always sends when the customer gives an email address.
- The order number uses the live format in section 7.
- The screen plays a chime and shows a badge when a live order arrives.

### Live order

A customer can place a live order only during event hours.
An item that is sold out cannot be ordered.
The owner can stop new mobile orders with the "Pause mobile orders" switch.

| State | Trigger | Result |
|---|---|---|
| Received | The Worker accepts the order. | The order appears in the Live POS Orders queue. The tracker opens. |
| Check payment | The customer selected a payment link or cash. | The queue shows "check payment". The owner confirms the payment by hand. |
| Paid | PayPal confirms the payment, or the owner confirms it. | The Worker sends the payment receipt. |
| Being prepared | The owner starts the order. | The tracker updates. |
| Ready | The owner marks the order ready. | The tracker alerts. The Worker sends the "ready" email. |
| Handed over | The owner marks the order paid and handed over. | The order goes into the sales ledger. |
| Canceled | The owner cancels the order. | The order leaves the queue. |

For a payment link, the page shows a "Copy Payment Description" button.
The description contains the order number so that the owner can match the payment.

### Pre-order, fixed allotment

The owner sets the allotment as a count of individual tamales for the event.

| State | Trigger | Result |
|---|---|---|
| Hold | The customer starts checkout. | The Worker reserves the tamales for 15 minutes. |
| Expired | The hold ends with no payment. | The Worker releases the tamales. |
| Paid | PayPal confirms the payment. | The Worker sends the payment receipt with the pickup address. |
| Being prepared | The owner starts the order. | The tracker updates. |
| Ready | The owner marks the order ready. | The tracker alerts. The Worker sends the "ready" email. |
| Handed over | The owner marks the order handed over. | The order goes into the sales ledger. |
| Refunded | The owner records a refund. | See section 12. |

### Pre-order, open interest, and batch request

These 2 types use the same life cycle.
A pre-order has an event and pickup at that event.
A batch request has no event, and the customer selects pickup or delivery.

| State | Trigger | Result |
|---|---|---|
| Requested | The customer submits the form. | The Worker sends "request received" to the customer and an alert to the owner. |
| Approved | The owner approves and confirms the final total. | The Worker sends "approved, pay now" with the total and a Pay button. |
| Declined | The owner declines. | The Worker sends "declined". |
| Expired | 72 hours pass after approval with no payment. | The Worker cancels the order. |
| Paid | PayPal confirms the payment. | The Worker sends the payment receipt with the pickup address. |
| Being prepared | The owner starts the order. | The tracker updates. |
| Ready | The owner marks the order ready. | The tracker alerts. The Worker sends the "ready" email. |
| Handed over | The owner marks the order handed over or delivered. | The order goes into the sales ledger. |
| Refunded | The owner records a refund. | See section 12. |

The owner can change the 72-hour limit in Settings.
At approval, the owner sets the delivery fee if the order is marked "delivery fee to be set".

## 6. Payments and fees

| Method | Status | Used by | Verification |
|---|---|---|---|
| PayPal Checkout | New | Live orders, pre-orders, batch requests | The Worker verifies the payment with PayPal. |
| Venmo link | Exists for POS | Live orders, POS sales | The owner checks the payment. |
| Cash App link | Exists for POS | Live orders, POS sales | The owner checks the payment. |
| Cash | Exists for POS | Live orders, POS sales | The owner takes the cash. |

Rules:

- A pre-order and a batch request are always paid in full by PayPal Checkout before preparation.
- No order uses a partial deposit.
- PayPal Checkout adds the online ordering fee to the order.
- An order that does not use PayPal Checkout has no online ordering fee.
- The online ordering fee is the customer share of the PayPal fee for that order.
- The default customer share is 50%. The owner can change the share in Settings.
- The Worker computes tax from the tax rate in Settings. The current rate is 8.7%.
- The delivery fee has a "taxable" switch in Settings.
- The owner sends each refund by hand in the payment application, then records it in admin.
- The default refund policy text is "Full refund until the pre-order cutoff, none after". The owner can edit it.

The Live POS screen today also offers PayPal.Me, Zelle, and Apple Pay. Remove these 3 methods.
The agreed methods are PayPal, Venmo, Cash App, and cash.

## 7. Order numbers

The Worker issues every order number for a customer order.

| Order type | Format | Sequence |
|---|---|---|
| Live order, POS sale | `#N - Date - First Last` | `N` starts at 1 for each event day. A POS sale with no name omits the name. |
| Pre-order, batch request | `BBT-####` | One sequence that does not start again. |

Current state: a POS sale uses `POS-YYYYMMDD-HHMMSS`, and `/order` uses `BBT-YYYY-` plus a random suffix.
Both formats change.

## 8. Events and kiosk

Current state: the admin "Availability" page edits pickup windows and pickup locations in Firestore.
The admin "Vendor" page and the kiosk page read one fixed sample session from `src/data/fixtures.ts`.
The kiosk waitlist form saves nothing.

V1 replaces pickup windows and vendor sessions with one event record.
The owner creates, edits, and closes events in admin.

Each event has these controls:

| Control | Function |
|---|---|
| Location, date, start hour, end hour | Define when live orders are possible. |
| Pre-order mode | Off, fixed allotment, or open interest. |
| Allotment | The count of individual tamales for fixed allotment. |
| Pre-order cutoff | The last time a customer can place a pre-order. |
| Items | The menu items for sale at the event. An item can be marked sold out. |
| Pause mobile orders | Stops new live orders from phones. |
| Kiosk order target | "Today's orders" or "next batch". |
| Kiosk link and QR code | Open the kiosk page and the mobile order page for this event. |
| Kiosk exit PIN | Required to leave the kiosk page. |

Kiosk behavior:

- With "today's orders", a kiosk order goes to the Live POS Orders queue.
- With "next batch", a kiosk order goes to the Pre-Orders queue.
- The QR code and the "Join the Next Batch" waitlist work with both targets.
- The Worker saves each waitlist entry.
- The kiosk returns to its home screen after a period with no input. This exists today.

For each event, admin gives a prep sheet and a pickup list.
The prep sheet shows the total count of each item to make.
The pickup list shows each order with the customer name, the items, and the payment state.

## 9. Tracker

Status: New. The current confirmation page (`/order/confirmation/:token`) shows an order one time and does not update.

The tracker shows 3 statuses: Received, Being prepared, Ready.
The tracker updates live while the page is open.

- The customer taps "Turn on alerts" one time.
- On Android, the alert enables sound, a screen wake lock, and vibration.
- On iPhone, a web page cannot vibrate. The page plays a chime and flashes.
- The page shows the text "Keep this page open".
- The phone keeps the order in local storage. If the customer opens the site again, the site shows the tracker.
- A closed page cannot alert. The "ready" email is the backup, and it contains the tracker link.

## 10. Delivery

Status: New. Delivery applies to batch requests only.

- Settings has one on/off switch for pickup and one for delivery.
- The owner sets a private start address. The public site never shows it.
- The owner defines distance rings from the start address. Each ring has a fee.
- The Worker finds the customer address with the US Census geocoder.
- The Worker measures the straight-line distance from the start address to the customer address.
- The ring that contains the distance gives the delivery fee.
- An address beyond the last ring is outside the delivery area. The Worker refuses delivery for it.
- If the geocoder cannot find the address, the Worker marks the order "delivery fee to be set".
- The owner can replace the delivery fee on any order at approval.

## 11. Admin areas

| Area | Route today | Status | V1 function |
|---|---|---|---|
| Dashboard | `/admin` | Exists | Summary metrics for the owner. |
| Live POS | `/admin/pos` | Changes | Record POS sales. Chime and badge for new live orders. |
| Live POS Orders | `/admin/orders` | Changes | Queue of live orders and POS sales for the event day. |
| Pre-Orders | `/admin/preorders` | Changes | Queue of pre-orders and batch requests. Approve, decline, set fees, record refunds. |
| Menu | `/admin/menu` | Exists | Edit items, prices, and status. |
| Events | `/admin/availability`, `/admin/vendor` | Changes | One area for events, kiosk links, prep sheets, and pickup lists. |
| Site Content | none | New | Edit public text and photographs. |
| Contacts | `/admin/contacts` | Changes | Receipt contacts and signups exist. Add contact messages, the waitlist, and a badge. |
| Settings | `/admin/settings` | Changes | Add the settings in the list below. |
| Reports | `/admin/reports` | Changes | Cover all order types. See section 12. |
| Backup | none | New | See the end of this section. |

The Live POS routes use a separate header today. Keep this.
Test mode exists today and keeps practice sales out of reports. Keep this.

The Site Content editor controls these items only:

- Hero photograph, tagline, and chips.
- About headline, story, and photograph.
- "How It Works" text.
- Policies, including the refund policy.
- Allergen notice. Use plain text with no license or inspection claims.
- Footer text.

Site images have fixed slots. The application stores each image in a Firestore document of approximately 250 KB.
The Instagram link points to `#` until the owner supplies a handle. Do not hide the link.

Settings today holds the timezone, tax rate, contact data, payment accounts, stock, test mode, and report inputs.
V1 adds these settings:

- Pickup on/off and delivery on/off.
- Private start address, delivery rings, and ring fees.
- Delivery fee "taxable" switch.
- Customer share of the PayPal fee.
- Payment time limit after approval (default 72 hours).

Contact form: the Worker saves each message to a collection that only the owner can read.
The Worker sends an alert to the owner. The customer gets no automatic reply.
Admin Contacts shows the messages with a badge for new messages.

Backup:

- The backup saves all business data to the Google Drive of the owner.
- The owner approves the Drive access with his Google account.
- Each backup is one dated file in one Drive folder. The folder keeps the last 30 files.
- The first admin visit of each week shows a "Back Up & Open Admin" screen. A week starts on Monday.
- The owner cannot skip this screen.
- The Live POS routes are exempt. The backup screen never blocks a sale.

## 12. Accounting rules

Current state: reports read POS sales only.
They give an income statement, a balance sheet, a sales tax report, and an expense ledger.

V1 rules:

- There is one sales ledger. When an order of any type is paid and handed over, it is recorded with POS sales.
- Stock and all reports read this one ledger.
- A prepayment is a liability until handover. It is not a sale before handover.
- Collected tax is a liability. It is not income.
- A fee is an expense.
- A refund is a new entry. A void is a new entry.
- Do not delete a real sale. Do not change a real sale without an entry that records the change.
- The owner records a refund in admin after he sends the money in the payment application.

Current state: admin can edit and delete a POS sale. This conflicts with the rules and must change.
A separate accounting session can refine these rules later.

## 13. Data model (proposal for implementers)

This section is a proposal. Implementers can change names and structure.
The access column is a requirement.
"Worker" access uses the service-account key and is not subject to the rules.

| Collection or document | Status | Key fields | Public | Owner | Worker |
|---|---|---|---|---|---|
| `menuItems` | Exists | name, description, prices, status, variants | Read | Read, write | Read |
| `events` | New, replaces `availabilityWindows` | location, start, end, pre-order mode, cutoff, items, kiosk target, pause switch, kiosk token | Read | Read, write | Read |
| `eventPrivate` | New | allotment remaining, kiosk exit PIN, day order counter | None | Read, write | Read, write |
| `pickupLocations` | Changes | name, general area, instructions, active | Read | Read, write | Read |
| `pickupLocationPrivate` | New | exact address | None | Read, write | Read |
| `settings/business` | Exists | timezone, tax rate, contact data, Instagram handle | Read | Read, write | Read |
| `settings/ordering` | New | pickup on/off, delivery on/off, fee share, payment time limit, delivery fee taxable | Read | Read, write | Read |
| `settings/delivery` | New | start address, rings, ring fees | None | Read, write | Read |
| `settings/payments` | Exists | Cash App, Venmo, and other account names | None | Read, write | Read |
| `settings/reporting`, `settings/app` | Exists | report inputs, test mode | None | Read, write | None |
| `settings/backup` | New | time of the last backup | None | Read, write | None |
| `siteContent` | New | text for each editable block | Read | Read, write | None |
| `siteImages` | New | one document for each fixed slot, image data | Read | Read, write | None |
| `orders` | Changes | type, order number, event, customer, items, totals, fee, tax, delivery, state, payment state, PayPal identifier, tracker token | None | Read, update state | Create, update |
| `trackers` | New | tracker token as document identifier, order number, status, time of update | Get by token | Read | Write |
| `customers` | New | email as key, first name, last name, marketing opt-in | None | Read, write | Create, update |
| `counters` | New | next `BBT-####` number | None | Read | Read, write |
| `sales` | Changes, replaces `posTickets` | source type, order reference, items, subtotal, tax, fee, total, payment method, test flag | None | Read, create | Create |
| `ledgerEntries` | New | refund or void, sale reference, amount, reason, time | None | Read, create | None |
| `inventory`, `inventoryAdjustments` | Exists | stock count for each item, adjustment log | None | Read, write | Read, write |
| `expenses` | Exists | date, category, amount | None | Read, write | None |
| `contactMessages` | New | name, email, message, time, read flag | None | Read, write | Create |
| `waitlist` | New | name, contact, interest, quantity, consent, event | None | Read, write | Create |
| `marketingSignups` | Changes | email, source, time | None | Read, write | Create |
| `receiptContacts` | Exists | email, opt-in, sale reference | None | Read, write | None |
| `admins` | Exists | must-change-password flag | None | Read, write | None |

Notes for implementers:

- Today `orders` permits a public create and a public get by token. Close both.
- Today `pickupLocations` holds the exact address in a public document. Move the address to an owner-only document.
- A tracker document must hold no email address and no street address.
- The Worker must issue order numbers and change allotments in Firestore transactions.
- Keep the rule that denies every path that has no match.

## 14. Email

The Worker sends all email through Resend from the domain bustostamales.com.

| Email | To | Trigger |
|---|---|---|
| POS receipt | Customer | A POS sale with an email address. |
| Request received | Customer | An open-interest pre-order or a batch request is submitted. |
| New request alert | Owner | An open-interest pre-order or a batch request is submitted. |
| Approved, pay now | Customer | The owner approves. Contains the final total and a Pay button. |
| Declined | Customer | The owner declines. |
| Payment receipt | Customer | A payment is confirmed. |
| Your order is ready | Customer | The order becomes Ready. Contains the tracker link. |
| Contact message alert | Owner | A customer submits the contact form. |

A receipt always sends. No setting can stop it.
A contact message gets no automatic reply.
The public contact data is banginbustostamales@gmail.com and 720-360-8688.

## 15. Build pieces

Build V1 in 4 pieces. Each piece is one pull request. No event sets a deadline.

| Piece | Contents |
|---|---|
| 1. Foundation | Worker in `worker/` with the service-account key. Resend and the domain email. Turnstile, honeypot, and server validation. New Firestore rules with public writes closed. Removal of EmailJS and `functions/`. Move the admin scripts from `functions/scripts/` to `scripts/` and correct the `package.json` commands. Deploy workflow change. POS receipt through the Worker. Contact form and admin Contacts badge. Updates signup through the Worker. Customer record by email. Site Content editor and site images. |
| 2. Events and ordering | Event records and the admin Events area. Kiosk with link, QR code, exit PIN, order target, and waitlist. Live orders with payment link and cash, the "Pause mobile orders" switch, and sold-out items. POS chime and badge. Pre-order modes and batch requests with approve and decline. Order numbers. Tracker. Delivery rings and the geocoder. Prep sheet and pickup list. Order emails. Customer form rules (names, email, quantity text, opt-in popup). |
| 3. Money | PayPal Checkout with Worker verification. Online ordering fee and its share setting. 15-minute hold and paid checkout for fixed allotment. Payment time limit and automatic cancellation. Payment receipt email. One sales ledger. Refund and void entries. Report changes for liabilities and fees. Delivery fee "taxable" switch. |
| 4. Backups | Google Drive approval. Dated backup files with a limit of 30. The weekly "Back Up & Open Admin" screen with the Live POS exemption. |

## 16. Open items

The owner must supply these items:

- Instagram handle.
- About story.
- Real menu and prices.
- Confirmation of the tax rate (8.7% now).
- Pickup locations.
- Delivery rings and fees.
- PayPal Business account.

These items need verification before piece 3 is released:

- The current PayPal fee rate.
- The PayPal rules on a fee that a seller adds to an order.
- The Colorado rules on a payment fee that a seller adds to an order.
- The Colorado rules on tax for a delivery fee. The accountant of the owner must confirm this.

The decisions do not cover these items. Get a decision before the related piece starts:

- The life cycle and payment of a kiosk order with the "next batch" target.
- The phone number on customer forms: optional or removed.
- Delivery for an event pre-order. This document assumes pickup at the event only.
- Tax on the online ordering fee.
