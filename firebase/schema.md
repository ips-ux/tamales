# Firestore Data Model

This file shows the collections that exist after build piece 2.
The field types are in `shared/model.ts`. `firebase/firestore.rules` is the source of truth for access.

Money is in integer cents. Times are ISO 8601 text in UTC. A path with no rule is denied.
"Worker" access uses the service-account key and is not subject to the rules.

| Collection or document | Key fields | Public | Owner | Worker |
| --- | --- | --- | --- | --- |
| `menuItems/{id}` | name, description, status, `bulkMenuEnabled`, `singlePriceCents`, `variants[]` (id, label, `unitQuantity`, `priceCents`, `minimumQuantity`, active) | Read | Read, write | Read |
| `events/{id}` | `EventRecord`: name, `areaName`, start, end, active, `itemIds`, `soldOutItemIds`, `preorderMode`, `preorderCutoffUtc`, allotment, live order switches, `kioskToken`, `kioskTarget`, `exitPinHash` | Read | Read, write | Read |
| `eventStock/{eventId}` | `EventStock`: `remaining` (tamales for each menu item id), `updatedAtUtc` | Read | Read, write | Read, write in a transaction |
| `eventPrivate/{eventId}` | `EventPrivate`: address, instructions | None | Read, write | Read |
| `settings/business` | timezone, `taxRateBps`, contact data | Read | Read, write | Read |
| `settings/ordering` | `OrderingSettings`: pickup and delivery switches, `minBatchTamales`, `minNoticeDays`, `deliveryRings`, `deliveryFeeTaxable`, `paymentWindowHours` | Read | Read, write | Read |
| `settings/orderingPrivate` | `OrderingPrivateSettings`: `startAddress`, `startLat`, `startLng`, `pickupAddress`, `pickupInstructions` | None | Read, write | Read, update `startLat` and `startLng` |
| `settings/payments` | payment account names | Read | Read, write | None |
| `settings/reporting`, `settings/app` | report inputs, test mode | None | Read, write | None |
| `orders/{id}` | `OrderRecord`. The id is a random UUID. | Get by id (interim) | List, update, delete | Create, update |
| `trackers/{trackerToken}` | `TrackerRecord`. No email address, phone number, or street address. | Get by token | Read | Create, update |
| `counters/orders` | `next`: the next `BBT-####` sequence, from 1001. `updatedAtUtc` | None | Read, write | Read, write in a transaction |
| `counters/live-{eventId}-{YYYY-MM-DD}` | `next`: the next live order number of that event day, from 1. The date is in the business time zone. | None | Read, write | Read, write in a transaction |
| `waitlist/{id}` | `WaitlistEntry`: `firstName`, `lastName`, email, interest, `eventId`, `eventName`, `createdAtUtc` | None | Read, write | Create |
| `customers/{sha256 of email}` | email, `firstName`, `lastName`, `marketingOptIn`, `createdAtUtc`, `updatedAtUtc` | None | Read, write | Create, update |
| `marketingSignups/{sha256 of email}` | email, source ("order", "waitlist", or the form name), `createdAtUtc` | None | Read, write | Create |
| `contactMessages/{id}` | `firstName`, `lastName`, email, phone, message, `createdAtUtc`, read | None | Read, write | Create |
| `siteContent/{docId}` | text for each editable block | Read | Read, write | None |
| `siteImages/{slot}` | image data for 1 fixed slot | Read | Read, write | None |
| `posTickets/{id}` | `ticketNumber`, items, subtotal, tax, total, `paymentMethod`, status | None | Read, write | Read |
| `receiptContacts/{id}` | email, opt-in, sale reference | None | Read, write | None |
| `inventory/{productId}`, `inventoryAdjustments/{id}` | stock count, adjustment log | None | Read, write | None |
| `expenses/{id}` | date, category, amount | None | Read, write | None |
| `admins/{uid}` | `mustChangePassword` | None | Read, write | None |
| `availabilityWindows/{id}`, `pickupLocations/{id}` | The old event model. `POST /api/orders` reads the first. Round 2 removes both. | Read | Read, write | Read |

- The Worker issues each order number and changes `eventStock` in 1 transaction with the order and the tracker.
- With no `eventStock/{eventId}` document, the Worker uses the `allotment` of the event as the count that remains.
- A fixed-allotment pre-order that the owner cancels gives its tamales back to `eventStock`.
- The public get on `orders` stays until round 2 removes the old confirmation page.
- The Worker does not change `marketingOptIn` from true to false.
