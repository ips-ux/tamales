export type ProductStatus = "active" | "inactive" | "sold_out";

export type SpiceLevel = "mild" | "medium" | "hot";

export interface BusinessSettings {
  id: string;
  name: string;
  shortName: string;
  /** IANA timezone the business operates in, e.g. "America/Denver". */
  timezone: string;
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
  /** Per-tamale price used by the Live POS; batch pricing lives in variants. 0 hides the item from the POS. */
  singlePriceCents: number;
  status: ProductStatus;
  bulkMenuEnabled: boolean;
  showWhenSoldOut: boolean;
  variants: MenuVariant[];
  sortOrder: number;
}

/** Account names for the payment links. Public read: `settings/payments`. */
export interface PaymentSettings {
  id: string;
  cashAppCashtag: string;
  venmoHandle: string;
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

/**
 * The old pickup window. Only src/lib/time.ts still names this type.
 * V1 uses `EventRecord` in shared/model.ts. Remove it when time.ts drops its window functions.
 */
