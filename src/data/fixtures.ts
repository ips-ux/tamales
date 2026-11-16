import type { BusinessSettings, MenuProduct, PaymentSettings } from "../lib/types";

export const businessSettings: BusinessSettings = {
  id: "default",
  name: "Bangin Bustos Tamales",
  shortName: "Bangin Bustos",
  timezone: "America/Denver",
  orderPolicy:
    "We confirm each pre-order and each batch request before we make it.",
  paymentPolicy:
    "You pay online after we confirm your order. We start the batch after we receive your payment.",
  contactPhone: "720-360-8688",
  contactEmail: "banginbustostamales@gmail.com",
  // Empty until the owner supplies a handle; the site links to "#" meanwhile.
  instagramHandle: "",
  taxRateBps: 870
};

export const menuProducts: MenuProduct[] = [
  {
    id: "red-tamales",
    name: "Red Tamales",
    slug: "red-tamales",
    description: "Slow-cooked red chile pork folded into tender masa and wrapped in corn husk.",
    ingredients: ["corn masa", "pork", "red chile", "garlic", "spices"],
    spiceLevel: "medium",
    allergyNotice: "Contains corn. We make all items in one kitchen.",
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
    allergyNotice: "Contains corn. We make all items in one kitchen.",
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

export const paymentSettings: PaymentSettings = {
  id: "default",
  cashAppCashtag: "BanginBustos",
  venmoHandle: "banginbustos"
};
