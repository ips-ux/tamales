# Firestore Data Model

This file shows the collections that exist after build piece 1.
The V1 target is in `docs/V1_FUNDAMENTALS.md` section 13. `firebase/firestore.rules` is the source of truth for access.

Money is in integer cents. Times are ISO 8601 text in UTC. A path with no rule is denied.
"Worker" access uses the service-account key and is not subject to the rules.

| Collection or document | Key fields | Public | Owner | Worker |
| --- | --- | --- | --- | --- |
| `menuItems/{id}` | name, description, status, `bulkMenuEnabled`, `singlePriceCents`, `variants[]` (id, label, `priceCents`, `minimumQuantity`, active) | Read | Read, write | Read |
| `availabilityWindows/{id}` | label, location, start, end, cutoff, capacity, active, `preordersEnabled` | Read | Read, write | Read |
| `pickupLocations/{id}` | name, address, instructions, active | Read | Read, write | None |
| `settings/business` | timezone, `taxRateBps`, contact data | Read | Read, write | Read |
| `settings/reporting`, `settings/app`, `settings/payments` | report inputs, test mode, payment account names | None | Read, write | None |
| `siteContent/{docId}` | text for each editable block | Read | Read, write | None |
| `siteImages/{slot}` | image data for 1 fixed slot | Read | Read, write | None |
| `orders/{publicToken}` | `orderNumber`, `publicToken`, status, `paymentStatus`, `availabilityWindowId`, customer, bulk, items, totals, `customerId` | Get by token | List, update, delete | Create |
| `customers/{sha256 of email}` | email, `firstName`, `lastName`, `marketingOptIn`, `createdAtUtc`, `updatedAtUtc` | None | Read, write | Create, update |
| `contactMessages/{id}` | `firstName`, `lastName`, email, phone, message, `createdAtUtc`, read | None | Read, write | Create |
| `marketingSignups/{sha256 of email}` | email, source, `createdAtUtc` | None | Read, write | Create |
| `posTickets/{id}` | `ticketNumber`, items, subtotal, tax, total, `paymentMethod`, status | None | Read, write | Read |
| `receiptContacts/{id}` | email, opt-in, sale reference | None | Read, write | None |
| `inventory/{productId}`, `inventoryAdjustments/{id}` | stock count, adjustment log | None | Read, write | None |
| `expenses/{id}` | date, category, amount | None | Read, write | None |
| `admins/{uid}` | `mustChangePassword` | None | Read, write | None |

The public get on `orders` stays until build piece 2 adds `trackers`.
The Worker does not change `marketingOptIn` from true to false.
