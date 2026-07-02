export type FulfillmentType = "scheduled_pickup" | "event_pickup";

export type ProductStatus = "active" | "inactive" | "sold_out";

export type SpiceLevel = "mild" | "medium" | "hot";

export type OrderStatus =
  | "new"
  | "confirmed"
  | "preparing"
  | "ready"
  | "completed"
  | "canceled";

export type PaymentStatus = "unpaid" | "deposit_paid" | "paid" | "refunded";

export interface BusinessSettings {
  id: string;
  name: string;
  shortName: string;
  timezone: "America/Denver";
  orderPolicy: string;
  paymentPolicy: string;
  contactPhone: string;
  contactEmail: string;
  instagramHandle: string;
  taxRateBps: number;
}

export interface MenuVariant {
  id: string;
  productId: string;
  label: string;
  unitQuantity: number;
  priceCents: number;
  minimumQuantity: number;
  active: boolean;
  sortOrder: number;
}

export interface MenuProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  ingredients: string[];
  spiceLevel: SpiceLevel;
  allergyNotice: string;
  imageUrl: string;
  status: ProductStatus;
  bulkMenuEnabled: boolean;
  showWhenSoldOut: boolean;
  variants: MenuVariant[];
  sortOrder: number;
}

export interface PaymentSettings {
  id: string;
  cashAppCashtag: string;
  paypalMe: string;
  venmoHandle: string;
  zelleContact: string;
  applePayEnabled: boolean;
  applePayNote: string;
}

export interface PosTicketItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
}

export interface PosTicket {
  id: string;
  ticketNumber: string;
  items: PosTicketItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod?: "cashapp" | "paypal" | "venmo" | "zelle" | "applepay";
  status: "open" | "awaiting_payment" | "paid" | "void";
  createdAtUtc: string;
}

export interface PickupLocation {
  id: string;
  name: string;
  address: string;
  instructions: string;
  active: boolean;
}

export interface AvailabilityWindow {
  id: string;
  locationId: string;
  label: string;
  fulfillmentType: FulfillmentType;
  startsAtUtc: string;
  endsAtUtc: string;
  cutoffAtUtc: string;
  capacity: number;
  committedOrders: number;
  active: boolean;
  instructions: string;
  vendorSessionId?: string;
}

export interface CartSelection {
  variantId: string;
  productId: string;
  quantity: number;
}

export interface CustomerInfo {
  name: string;
  mobile: string;
  email: string;
  preferredContact: "text" | "phone" | "email";
  notes: string;
}

export interface BulkOrderInfo {
  enabled: boolean;
  occasion: string;
  guestCount: string;
  desiredReadyTime: string;
  packagingRequest: string;
  additionalInstructions: string;
}

export interface OrderLineSnapshot {
  productId: string;
  variantId: string;
  productName: string;
  variantLabel: string;
  unitQuantity: number;
  unitPriceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface OrderTotals {
  subtotalCents: number;
  taxCents: number;
  feeCents: number;
  totalCents: number;
}

export interface OrderDraft {
  fulfillmentType: FulfillmentType;
  availabilityWindowId: string;
  items: CartSelection[];
  customer: CustomerInfo;
  bulk: BulkOrderInfo;
  idempotencyKey: string;
  turnstileToken?: string;
  vendorSessionToken?: string;
}

export interface OrderRecord {
  id: string;
  orderNumber: string;
  publicToken: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentType: FulfillmentType;
  availabilityWindowId: string;
  customer: CustomerInfo;
  bulk: BulkOrderInfo;
  items: OrderLineSnapshot[];
  totals: OrderTotals;
  createdAtUtc: string;
  updatedAtUtc: string;
  privateNotes: string;
  vendorSessionId?: string;
}

export interface VendorSession {
  id: string;
  publicToken: string;
  name: string;
  eventLocation: string;
  startsAtUtc: string;
  endsAtUtc: string;
  enabledProductIds: string[];
  availabilityWindowId: string;
  ordersEnabled: boolean;
  contactCaptureEnabled: boolean;
  active: boolean;
  exitPinRequired: boolean;
}

export interface ContactSubmission {
  id: string;
  name: string;
  contact: string;
  preferredContact: "text" | "phone" | "email";
  productInterest: string;
  approximateQuantity: string;
  consentToContact: boolean;
  createdAtUtc: string;
  source: "waitlist" | "contact" | "vendor";
}
