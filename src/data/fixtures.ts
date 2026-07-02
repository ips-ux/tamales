import type {
  AvailabilityWindow,
  BusinessSettings,
  ContactSubmission,
  MenuProduct,
  PaymentSettings,
  OrderRecord,
  PickupLocation,
  VendorSession
} from "../lib/types";

export const businessSettings: BusinessSettings = {
  id: "default",
  name: "Bangin Bustos Tamales",
  shortName: "Bangin Bustos",
  timezone: "America/Denver",
  orderPolicy:
    "Order requests are reviewed by the owner. Your order is not final until it is confirmed by text, call, or email.",
  paymentPolicy:
    "Payment is collected after confirmation. Large batches may require a deposit before production.",
  contactPhone: "(720) 555-0186",
  contactEmail: "orders@banginbustos.example",
  instagramHandle: "@banginbustostamales",
  taxRateBps: 870
};

export const pickupLocations: PickupLocation[] = [
  {
    id: "pop-up-westminster",
    name: "Westminster Pop-Up",
    address: "Exact pickup pin shared after confirmation",
    instructions: "Pull up during the selected window and text when you arrive.",
    active: true
  },
  {
    id: "event-northglenn",
    name: "Northglenn Vendor Table",
    address: "Event booth location shared by text",
    instructions: "Bring your order number to the vendor table.",
    active: true
  }
];

export const menuProducts: MenuProduct[] = [
  {
    id: "red-tamales",
    name: "Red Tamales",
    slug: "red-tamales",
    description: "Slow-cooked red chile pork folded into tender masa and wrapped in corn husk.",
    ingredients: ["corn masa", "pork", "red chile", "garlic", "spices"],
    spiceLevel: "medium",
    allergyNotice: "Contains corn. Prepared in a home-style kitchen that may handle common allergens.",
    imageUrl: "/media/chile_red.webp",
    singlePriceCents: 350,
    status: "active",
    bulkMenuEnabled: true,
    showWhenSoldOut: true,
    sortOrder: 1,
    variants: [
      {
        id: "red-half-dozen",
        productId: "red-tamales",
        label: "Half dozen",
        unitQuantity: 6,
        priceCents: 1800,
        minimumQuantity: 1,
        active: true,
        sortOrder: 1
      },
      {
        id: "red-dozen",
        productId: "red-tamales",
        label: "Dozen",
        unitQuantity: 12,
        priceCents: 3400,
        minimumQuantity: 1,
        active: true,
        sortOrder: 2
      }
    ]
  },
  {
    id: "green-tamales",
    name: "Green Tamales",
    slug: "green-tamales",
    description: "Roasted green chile chicken with bright salsa verde flavor and soft masa.",
    ingredients: ["corn masa", "chicken", "green chile", "tomatillo", "cilantro", "spices"],
    spiceLevel: "mild",
    allergyNotice: "Contains corn. Prepared in a home-style kitchen that may handle common allergens.",
    imageUrl: "/media/pork_green.webp",
    singlePriceCents: 350,
    status: "active",
    bulkMenuEnabled: true,
    showWhenSoldOut: true,
    sortOrder: 2,
    variants: [
      {
        id: "green-half-dozen",
        productId: "green-tamales",
        label: "Half dozen",
        unitQuantity: 6,
        priceCents: 1800,
        minimumQuantity: 1,
        active: true,
        sortOrder: 1
      },
      {
        id: "green-dozen",
        productId: "green-tamales",
        label: "Dozen",
        unitQuantity: 12,
        priceCents: 3400,
        minimumQuantity: 1,
        active: true,
        sortOrder: 2
      }
    ]
  }
];

export const availabilityWindows: AvailabilityWindow[] = [
  {
    id: "sat-morning-westminster",
    locationId: "pop-up-westminster",
    label: "Saturday morning batch",
    fulfillmentType: "scheduled_pickup",
    startsAtUtc: "2026-06-20T16:00:00.000Z",
    endsAtUtc: "2026-06-20T18:00:00.000Z",
    cutoffAtUtc: "2026-06-19T23:00:00.000Z",
    capacity: 28,
    committedOrders: 11,
    active: true,
    instructions: "Orders are packed warm. Pickup details are confirmed after acceptance."
  },
  {
    id: "sun-event-northglenn",
    locationId: "event-northglenn",
    label: "Sunday vendor table",
    fulfillmentType: "event_pickup",
    startsAtUtc: "2026-06-21T19:00:00.000Z",
    endsAtUtc: "2026-06-21T22:00:00.000Z",
    cutoffAtUtc: "2026-06-21T16:00:00.000Z",
    capacity: 36,
    committedOrders: 18,
    active: true,
    vendorSessionId: "northglenn-market",
    instructions: "Pick up at the Bangin Bustos table during event hours."
  }
];

export const vendorSessions: VendorSession[] = [
  {
    id: "northglenn-market",
    publicToken: "vendor_demo_northglenn",
    name: "Northglenn Summer Market",
    eventLocation: "Northglenn vendor table",
    startsAtUtc: "2026-06-21T18:30:00.000Z",
    endsAtUtc: "2026-06-21T23:00:00.000Z",
    enabledProductIds: ["red-tamales", "green-tamales"],
    availabilityWindowId: "sun-event-northglenn",
    ordersEnabled: true,
    contactCaptureEnabled: true,
    active: true,
    exitPinRequired: true
  }
];

export const paymentSettings: PaymentSettings = {
  id: "default",
  cashAppCashtag: "BanginBustos",
  paypalMe: "banginbustos",
  venmoHandle: "banginbustos",
  zelleContact: "orders@banginbustos.example",
  applePayEnabled: false,
  applePayNote: "Apple Pay needs a merchant/payment-service setup before live use."
};

export const sampleOrders: OrderRecord[] = [
  {
    id: "ord_1001",
    orderNumber: "BBT-2026-1001",
    publicToken: "sample_confirmation_token",
    status: "new",
    paymentStatus: "unpaid",
    fulfillmentType: "scheduled_pickup",
    availabilityWindowId: "sat-morning-westminster",
    customer: {
      name: "Marisol Vega",
      mobile: "(720) 555-0148",
      email: "marisol@example.com",
      preferredContact: "text",
      notes: "Please text when the pickup pin is ready."
    },
    bulk: {
      enabled: false,
      occasion: "",
      guestCount: "",
      desiredReadyTime: "",
      packagingRequest: "",
      additionalInstructions: ""
    },
    items: [
      {
        productId: "red-tamales",
        variantId: "red-dozen",
        productName: "Red Tamales",
        variantLabel: "Dozen",
        unitQuantity: 12,
        unitPriceCents: 3400,
        quantity: 2,
        lineTotalCents: 6800
      }
    ],
    totals: {
      subtotalCents: 6800,
      taxCents: 592,
      feeCents: 0,
      totalCents: 7392
    },
    createdAtUtc: "2026-06-17T18:30:00.000Z",
    updatedAtUtc: "2026-06-17T18:30:00.000Z",
    privateNotes: "Confirm before Friday afternoon."
  },
  {
    id: "ord_1002",
    orderNumber: "BBT-2026-1002",
    publicToken: "sample_confirmed_token",
    status: "confirmed",
    paymentStatus: "deposit_paid",
    fulfillmentType: "event_pickup",
    availabilityWindowId: "sun-event-northglenn",
    customer: {
      name: "Daniel Ramos",
      mobile: "(303) 555-0119",
      email: "daniel@example.com",
      preferredContact: "phone",
      notes: "Needs a call because reception is spotty at work."
    },
    bulk: {
      enabled: true,
      occasion: "Birthday lunch",
      guestCount: "24",
      desiredReadyTime: "1:30 PM",
      packagingRequest: "Separate red and green by tray",
      additionalInstructions: "Label each tray clearly."
    },
    items: [
      {
        productId: "red-tamales",
        variantId: "red-dozen",
        productName: "Red Tamales",
        variantLabel: "Dozen",
        unitQuantity: 12,
        unitPriceCents: 3400,
        quantity: 1,
        lineTotalCents: 3400
      },
      {
        productId: "green-tamales",
        variantId: "green-dozen",
        productName: "Green Tamales",
        variantLabel: "Dozen",
        unitQuantity: 12,
        unitPriceCents: 3400,
        quantity: 1,
        lineTotalCents: 3400
      }
    ],
    totals: {
      subtotalCents: 6800,
      taxCents: 592,
      feeCents: 0,
      totalCents: 7392
    },
    createdAtUtc: "2026-06-16T15:05:00.000Z",
    updatedAtUtc: "2026-06-17T03:10:00.000Z",
    privateNotes: "Deposit received by cash app."
  }
];

export const contactSubmissions: ContactSubmission[] = [
  {
    id: "contact_001",
    name: "Elena Cruz",
    contact: "(720) 555-0166",
    preferredContact: "text",
    productInterest: "Green tamales",
    approximateQuantity: "2 dozen",
    consentToContact: true,
    createdAtUtc: "2026-06-17T20:20:00.000Z",
    source: "waitlist"
  }
];
