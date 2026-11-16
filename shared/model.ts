// The V1 data model for events and orders (build piece 2).
// The site (src/) and the Worker (worker/) both import this file. Keep it free
// of imports and of browser or Worker APIs, so both can compile it.
// Functions belong in the other files in shared/. This file holds types only.
// See docs/V1_FUNDAMENTALS.md sections 5 to 10 and 13.

// ---------------------------------------------------------------------------
// Events. `events/{id}` is public read, owner write.
// ---------------------------------------------------------------------------

/** How pre-orders work for an event. */
export type PreorderMode = "off" | "fixed" | "open";

/** Where a kiosk order goes: the Live POS Orders queue or the Pre-Orders queue. */
export type KioskTarget = "today" | "next_batch";

export interface EventRecord {
  id: string;
  name: string;
  /** Public area name, for example "Westminster". Never the exact address. */
  areaName: string;
  startsAtUtc: string;
  endsAtUtc: string;
  /** False hides the event from the public site. */
  active: boolean;

  /** Menu item ids for sale at this event. Empty means all active menu items. */
  itemIds: string[];
  /** Menu item ids that are sold out for live orders at this event. */
  soldOutItemIds: string[];

  preorderMode: PreorderMode;
  /** The last time a customer can place a pre-order. */
  preorderCutoffUtc: string;
  /**
   * Fixed mode only: tamales for pre-order for each menu item id.
   * The count that remains is in `eventStock/{id}`.
   */
  allotment: Record<string, number>;

  /** Live orders (phone and kiosk) are possible during event hours when this is true. */
  liveOrdersEnabled: boolean;
  /** The owner's "Pause mobile orders" switch. */
  liveOrdersPaused: boolean;

  /** Unguessable token in the kiosk link: /kiosk/{kioskToken}. */
  kioskToken: string;
  kioskTarget: KioskTarget;
  waitlistEnabled: boolean;
  /** SHA-256 hex of `${id}:${pin}`. The kiosk compares it in the browser. Empty means no PIN. */
  exitPinHash: string;
}

/** `eventStock/{eventId}`: public read, written by the Worker and the owner. */
export interface EventStock {
  /** Fixed mode: tamales that remain for pre-order, for each menu item id. */
  remaining: Record<string, number>;
  updatedAtUtc: string;
}

/** `eventPrivate/{eventId}`: owner only. The Worker reads it for the confirmation email. */
export interface EventPrivate {
  /** The exact pickup address. Sent to the customer only after payment. */
  address: string;
  instructions: string;
}

// ---------------------------------------------------------------------------
// Settings.
// ---------------------------------------------------------------------------

export interface DeliveryRing {
  /** Outer radius in miles, straight line from the start address. */
  miles: number;
  feeCents: number;
}

/** `settings/ordering`: public read, owner write. */
export interface OrderingSettings {
  /** Batch requests: pickup offered. */
  pickupEnabled: boolean;
  /** Batch requests: delivery offered. */
  deliveryEnabled: boolean;
  /** Public area name for batch pickup. */
  pickupAreaName: string;
  /** Smallest batch request, in tamales. */
  minBatchTamales: number;
  /** Smallest number of days between a batch request and its requested date. */
  minNoticeDays: number;
  /** Rings sorted by miles, smallest first. Beyond the last ring is outside the delivery area. */
  deliveryRings: DeliveryRing[];
  deliveryFeeTaxable: boolean;
  /** Hours an approved order has to pay before it expires. */
  paymentWindowHours: number;
  /** Minutes a fixed-allotment pre-order holds its tamales while the customer pays. */
  holdMinutes: number;
  /** PayPal fee rate in basis points of the charged amount, for example 349 = 3.49%. */
  paypalFeeBps: number;
  /** PayPal fixed fee for each payment, in cents. */
  paypalFeeFixedCents: number;
  /** Percent of the PayPal fee that the customer pays as the online ordering fee. 0 to 100. */
  feeSharePct: number;
}

export const orderingDefaults: OrderingSettings = {
  pickupEnabled: true,
  deliveryEnabled: false,
  pickupAreaName: "",
  minBatchTamales: 12,
  minNoticeDays: 3,
  deliveryRings: [],
  deliveryFeeTaxable: false,
  paymentWindowHours: 72,
  holdMinutes: 15,
  paypalFeeBps: 349,
  paypalFeeFixedCents: 49,
  feeSharePct: 50
};

/** `settings/orderingPrivate`: owner only. The Worker reads it. */
export interface OrderingPrivateSettings {
  /** Delivery start address. Never shown to a customer. */
  startAddress: string;
  /** Cached by the Worker after it finds the start address. The owner clears them when the address changes. */
  startLat: number | null;
  startLng: number | null;
  /** Exact address for batch pickup. Sent to the customer only after payment. */
  pickupAddress: string;
  pickupInstructions: string;
}

// ---------------------------------------------------------------------------
// Orders. `orders/{id}` is owner read; only the Worker writes it.
// ---------------------------------------------------------------------------

/** live = placed during an event for handover at that event. */
export type OrderKind = "live" | "preorder" | "batch";

export type OrderSource = "web" | "mobile" | "kiosk";

export type Fulfillment = "event_pickup" | "pickup" | "delivery";

/**
 * requested   open-interest pre-order or batch request, waiting for the owner
 * approved    waiting for payment: owner approved, or a fixed-allotment pre-order on hold
 * declined    owner declined
 * received    accepted: a live order, or a paid approved order
 * preparing   owner started the order
 * ready       owner marked it ready; the tracker alerts
 * handed_over customer has the order
 * canceled    owner canceled
 * expired     approved but not paid in time
 */
export type OrderState =
  | "requested"
  | "approved"
  | "declined"
  | "received"
  | "preparing"
  | "ready"
  | "handed_over"
  | "canceled"
  | "expired";

/** check_payment = the customer says they paid by payment link or will pay cash; the owner confirms. */
export type PaymentState = "unpaid" | "check_payment" | "paid" | "refunded";

/** paypal = PayPal Checkout (also shows Venmo inside PayPal). "unset" = not selected yet. */
export type PaymentMethod = "unset" | "paypal" | "venmo" | "cashapp" | "cash";

export interface OrderCustomer {
  firstName: string;
  lastName: string;
  email: string;
  /** Optional. Empty when the customer gives none. */
  phone: string;
  marketingOptIn: boolean;
}

/** One line the browser asks for. `variantId` is "single" for single tamales. */
export interface OrderLineInput {
  itemId: string;
  variantId: string;
  quantity: number;
}

/** One line as the Worker saved it, with the price at the time of the order. */
export interface OrderLine {
  itemId: string;
  variantId: string;
  itemName: string;
  /** For example "Half dozen", or "Single". */
  variantLabel: string;
  /** Tamales in 1 unit of this line: 1, 6, 12, ... */
  unitTamales: number;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderTotals {
  subtotalCents: number;
  deliveryFeeCents: number;
  /** The customer share of the PayPal fee. 0 when the order does not use PayPal Checkout. */
  onlineFeeCents: number;
  taxCents: number;
  totalCents: number;
}

/** computed = from the rings. to_be_set = address not found; the owner sets the fee. owner_set = the owner changed it. */
export type DeliveryFeeStatus = "computed" | "to_be_set" | "owner_set";

export interface OrderDelivery {
  address: string;
  distanceMiles: number | null;
  feeStatus: DeliveryFeeStatus;
}

/** What the customer asked for on a batch request. */
export interface OrderRequestedTime {
  /** YYYY-MM-DD in the business time zone. */
  date: string;
  /** Free text, for example "5 PM to 7 PM". */
  timeRange: string;
}

export interface OrderRecord {
  id: string;
  kind: OrderKind;
  source: OrderSource;
  state: OrderState;
  paymentState: PaymentState;
  paymentMethod: PaymentMethod;

  /** Display number. Live: "#12 - Nov 14 - Jane Doe". Pre-order or batch: "BBT-1042". */
  orderNumber: string;
  /** The N in the number: the day sequence for live orders, the running sequence for the others. */
  sequence: number;
  /** Text the customer puts in a Venmo or Cash App payment so the owner can match it. */
  paymentDescription: string;

  /** Empty for a batch request. */
  eventId: string;
  /** Copied from the event at order time, so lists do not need a second read. */
  eventName: string;
  fulfillment: Fulfillment;

  customer: OrderCustomer;
  /** `customers/{customerId}`. */
  customerId: string;
  items: OrderLine[];
  /** Total tamales in the order. */
  tamaleCount: number;
  totals: OrderTotals;

  /** Delivery orders only. */
  delivery: OrderDelivery | null;
  /** Batch requests only. */
  requested: OrderRequestedTime | null;
  /** Final date and time, set by the owner at approval. Empty until then. */
  scheduledAtUtc: string;
  /** Customer note, max 500 characters. */
  customerNote: string;
  /** Owner note. Never shown to the customer. */
  ownerNote: string;
  /** Shown to the customer when the owner declines or cancels. */
  reason: string;

  /** `trackers/{trackerToken}`; the tracker page is /t/{trackerToken}. */
  trackerToken: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  /** When the owner approved. Empty until then. */
  approvedAtUtc: string;
  /** approvedAtUtc plus the payment window. Empty until approval. */
  payByUtc: string;
  /** True when this order took tamales from eventStock. */
  stockHeld: boolean;

  // Money (build piece 3). See shared/moneyModel.ts.
  /** PayPal order id from the last "create payment" call. Empty until then. */
  paypalOrderId: string;
  /** PayPal capture id. Empty until the payment is captured. */
  paypalCaptureId: string;
  /** The fee PayPal kept, from the capture. 0 for other methods. An expense. */
  paypalFeeCents: number;
  /** When the payment was confirmed. Empty until then. */
  paidAtUtc: string;
  /** Total refunded to the customer so far. */
  refundedCents: number;
  /** `posTickets/{saleId}`: the sale written at handover. Empty until then. */
  saleId: string;
}

/**
 * `trackers/{token}`: public get by token (no list). The Worker writes it.
 * It must hold no email address, no phone number, and no street address.
 */
export interface TrackerRecord {
  /** Empty until approval. The tracker shows the time that remains to pay. */
  payByUtc: string;
  refundedCents: number;
  orderNumber: string;
  kind: OrderKind;
  state: OrderState;
  paymentState: PaymentState;
  paymentMethod: PaymentMethod;
  paymentDescription: string;
  firstName: string;
  eventName: string;
  fulfillment: Fulfillment;
  /** `quantity` is the units of the line. The label carries the size, for example "Red Tamales, Half dozen". */
  items: Array<{ label: string; quantity: number }>;
  totals: OrderTotals;
  /** Reason for a decline or a cancel. */
  reason: string;
  scheduledAtUtc: string;
  updatedAtUtc: string;
}

/** `waitlist/{id}`: owner read. The Worker creates it. */
export interface WaitlistEntry {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  /** Free text, for example "Red, 2 dozen". */
  interest: string;
  /** Empty when the entry did not come from an event. */
  eventId: string;
  eventName: string;
  createdAtUtc: string;
}

// ---------------------------------------------------------------------------
// HTTP contract. Bodies and answers for the Worker routes of piece 2.
// Every route is POST with JSON. Answers are { ok: true, ...data } or
// { ok: false, error }. Public routes also take `turnstileToken` and `website`.
// ---------------------------------------------------------------------------

/** POST /api/v1/orders */
export interface CreateOrderInput {
  kind: OrderKind;
  source: OrderSource;
  /** Required for live and preorder. Empty for batch. */
  eventId: string;
  /** Required when source is "kiosk": must equal the event's kioskToken. */
  kioskToken: string;
  items: OrderLineInput[];
  customer: OrderCustomer;
  /** Batch only: "pickup" or "delivery". Others are always "event_pickup". */
  fulfillment: Fulfillment;
  /** Delivery only. */
  deliveryAddress: string;
  /** Batch only. */
  requested: OrderRequestedTime | null;
  /** Live only: "paypal", "venmo", "cashapp" or "cash". Others send "unset"; the Worker saves "paypal". */
  paymentMethod: PaymentMethod;
  customerNote: string;
  /**
   * Optional. 1 to 64 characters: letters, digits, "-" and "_". The browser makes 1 key for each
   * order attempt and sends it again on a retry. The Worker then returns the first order and makes no second one.
   */
  idempotencyKey?: string;
}

export interface CreateOrderResult {
  trackerToken: string;
  orderNumber: string;
  state: OrderState;
}

/** POST /api/v1/delivery-quote — no Turnstile; it writes nothing. */
export interface DeliveryQuoteInput {
  address: string;
}

export interface DeliveryQuoteResult {
  /** ok = inside a ring. outside = beyond the last ring. not_found = the address could not be located. */
  status: "ok" | "outside" | "not_found";
  feeCents: number;
  distanceMiles: number | null;
}

/** POST /api/v1/waitlist */
export interface WaitlistInput {
  firstName: string;
  lastName: string;
  email: string;
  interest: string;
  eventId: string;
  /** True also adds the email address to the email list. */
  marketingOptIn: boolean;
}

/**
 * POST /api/admin/orders/action — owner only (Firebase ID token).
 * The Worker checks the transition, saves the order and the tracker, and
 * sends the email for that step.
 */
export type OrderAction =
  | "approve"
  | "decline"
  | "mark_paid"
  | "mark_unpaid"
  | "prepare"
  | "ready"
  | "hand_over"
  | "cancel"
  /** Allowed in every state. Changes only `ownerNote`. Sends no email. */
  | "save_note";

export interface OrderActionInput {
  orderId: string;
  action: OrderAction;
  /** approve: sets or replaces the delivery fee. Omit to keep the computed fee. */
  deliveryFeeCents?: number;
  /** approve: the final date and time. */
  scheduledAtUtc?: string;
  /** decline and cancel: shown to the customer. */
  reason?: string;
  /** Any action: replaces the owner note when present. */
  ownerNote?: string;
}

export interface OrderActionResult {
  order: OrderRecord;
}
