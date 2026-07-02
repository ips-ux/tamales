# Firebase Data Model

The production database uses Firestore collections with stable document IDs and UTC timestamps.
Money is stored as integer cents. Customer-visible references use `orderNumber` and
`publicToken`; internal document IDs are never exposed by public APIs.

## Collections

- `businessSettings/{id}`: public business copy, tax settings, contact channels, policy text.
- `menuItems/{id}`: product details, display order, active/sold-out state, image path.
- `menuVariants/{id}`: package sizes, price cents, minimum quantity, active state, product FK.
- `pickupLocations/{id}`: owner-configured pickup or event locations.
- `availabilityWindows/{id}`: capacity, cutoff, active state, location FK, optional vendor FK.
- `orders/{id}`: private order record, customer contact, status, totals, public token, embedded item snapshots.
- `orderItems/{id}`: optional future split-out collection if order item querying becomes necessary.
- `vendorSessions/{id}`: public session token, enabled products, QR/order flags, timing.
- `contactSubmissions/{id}`: waitlist/contact-capture entries, consent, source.
- `paymentSettings/{id}`: Cash App, PayPal, Venmo, Zelle, and Apple Pay display/config values for Live POS.
- `adminAudit/{id}`: append-only owner/admin actions such as custom-claim assignment.
- `orderEvents/{id}`: append-only status and note history.
- `submissionIdempotencyKeys/{id}`: request hash and resulting order ID.

## Indexes

The committed `firestore.indexes.json` covers common owner queries: status, created date,
fulfillment window, public token lookup, vendor session, and active menu visibility.
