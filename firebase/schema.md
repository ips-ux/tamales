# Firestore Data Model

This file shows the collections that exist after build piece 3.
The field types are in `shared/model.ts` and `shared/moneyModel.ts`. `firebase/firestore.rules` is the source of truth for access.

Money is in integer cents. Times are ISO 8601 text in UTC. A path with no rule is denied.
"Worker" access uses the service-account key and is not subject to the rules.

| Collection or document | Key fields | Public | Owner | Worker |
| --- | --- | --- | --- | --- |
| `menuItems/{id}` | name, description, status, `bulkMenuEnabled`, `singlePriceCents`, `variants[]` (id, label, `unitQuantity`, `priceCents`, `minimumQuantity`, active) | Read | Read, write | Read |
| `events/{id}` | `EventRecord`: name, `areaName`, start, end, active, `itemIds`, `soldOutItemIds`, `preorderMode`, `preorderCutoffUtc`, allotment, live order switches, `kioskToken`, `kioskTarget`, `exitPinHash` | Read | Read, write | Read |
| `eventStock/{eventId}` | `EventStock`: `remaining` (tamales for each menu item id), `updatedAtUtc` | Read | Read, write | Read, write in a transaction |
| `eventPrivate/{eventId}` | `EventPrivate`: address, instructions | None | Read, write | Read |
| `settings/business` | timezone, `taxRateBps`, contact data | Read | Read, write | Read |
| `settings/ordering` | `OrderingSettings`: pickup and delivery switches, `minBatchTamales`, `minNoticeDays`, `deliveryRings`, `deliveryFeeTaxable`, `paymentWindowHours`, `holdMinutes`, `paypalFeeBps`, `paypalFeeFixedCents`, `feeSharePct` | Read | Read, write | Read |
| `settings/orderingPrivate` | `OrderingPrivateSettings`: `startAddress`, `startLat`, `startLng`, `pickupAddress`, `pickupInstructions` | None | Read, write | Read, update `startLat` and `startLng` |
| `settings/payments` | payment account names | Read | Read, write | None |
| `settings/reporting`, `settings/app` | report inputs, test mode | None | Read, write | None |
| `orders/{id}` | `OrderRecord`, with `stockHeld` true when the order took tamales from `eventStock`. Money fields: `paypalOrderId`, `paypalCaptureId`, `paypalFeeCents`, `paidAtUtc`, `refundedCents`, `saleId`. The id is a random UUID, or a hash of the email address and the `idempotencyKey` of the request. | None | Read | Create, update |
| `trackers/{trackerToken}` | `TrackerRecord`, with `payByUtc` and `refundedCents`. No email address, phone number, or street address. | Get by token | Read | Create, update |
| `counters/orders` | `next`: the next `BBT-####` sequence, from 1001. `updatedAtUtc` | None | Read, write | Read, write in a transaction |
| `counters/live-{eventId}-{YYYY-MM-DD}` | `next`: the next live order number of that event day, from 1. The date is in the business time zone. | None | Read, write | Read, write in a transaction |
| `waitlist/{id}` | `WaitlistEntry`: `firstName`, `lastName`, email, interest, `eventId`, `eventName`, `createdAtUtc` | None | Read, write | Create |
| `customers/{sha256 of email}` | email, `firstName`, `lastName`, `marketingOptIn`, `createdAtUtc`, `updatedAtUtc` | None | Read, write | Create, update |
| `marketingSignups/{sha256 of email}` | email, source ("order", "waitlist", or the form name), `createdAtUtc` | None | Read, write | Create |
| `contactMessages/{id}` | `firstName`, `lastName`, email, phone, message, `createdAtUtc`, read | None | Read, write | Create |
| `siteContent/{docId}` | text for each editable block | Read | Read, write | None |
| `siteImages/{slot}` | image data for 1 fixed slot | Read | Read, write | None |
| `posTickets/{id}` | The 1 sales ledger. `ticketNumber`, `items[]` (`productId`, `productName`, quantity, `unitPriceCents`), `subtotalCents`, `taxCents`, `totalCents`, `paymentMethod`, `customerName`, `isTest`, status, `createdAtUtc`, `soldByEmail`. A sale from an order also has `OrderSaleFields`: `source` "order", `orderId`, `orderKind`, `deliveryFeeCents`, `onlineFeeCents`, `paypalFeeCents`. | None | Read, create, update. Delete only when `isTest` is true. | Read. Create at handover. |
| `ledgerEntries/{id}` | `LedgerEntry`: type (refund, void, edit), `saleId`, `orderId`, reference, `amountCents`, `taxCents`, reason, detail, `byEmail`, `isTest`, `createdAtUtc` | None | Read, create. No update, no delete. | Create for the refund of an order |
| `receiptContacts/{id}` | email, opt-in, sale reference | None | Read, write | None |
| `inventory/{productId}` | `productId`, `productName`, `stockCount` (tamales), `updatedAtUtc` | None | Read, write | Read, update at handover |
| `inventoryAdjustments/{id}` | adjustment log | None | Read, write | None |
| `expenses/{id}` | date, category, amount | None | Read, write | None |
| `admins/{uid}` | `mustChangePassword` | None | Read, write | None |

- The Worker issues each order number and changes `eventStock` in 1 transaction with the order and the tracker.
- With no `eventStock/{eventId}` document, the Worker uses the `allotment` of the event as the count that remains.
- A fixed-allotment pre-order that the owner cancels or declines gives its tamales back to `eventStock`. The Worker reads `stockHeld` to know.
- A second `POST /api/v1/orders` with the same `idempotencyKey` and email address returns the first order. It saves nothing and sends no email.
- The owner changes an order only through `POST /api/admin/orders/action`. The action `save_note` changes only `ownerNote`.
- The Worker does not change `marketingOptIn` from true to false.

Money (build piece 3):

- A pre-order and a batch request have `paymentMethod` "paypal" and the online ordering fee from the start.
- A fixed-allotment pre-order starts in state `approved` with `payByUtc` = now + `holdMinutes`. An approval sets `payByUtc` = now + `paymentWindowHours`.
- `POST /api/v1/payments/create` saves `paypalOrderId`. `POST /api/v1/payments/capture` sets `paymentState` "paid", `paidAtUtc`, `paypalCaptureId` and `paypalFeeCents`, and moves `approved` to `received`.
- The scheduled run of the Worker (each 5 minutes) sets `approved`, unpaid orders with a `payByUtc` in the past to `expired`. It gives held tamales back to `eventStock`.
- A handover needs `paymentState` "paid". In 1 transaction, the Worker writes `posTickets/{order id}`, sets `saleId`, and decreases `inventory/{menu item id}.stockCount` by the tamales of the order.
- `POST /api/admin/orders/refund` adds to `refundedCents` and creates 1 `ledgerEntries` document. It does not change the sale.
