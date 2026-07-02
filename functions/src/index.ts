import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";

initializeApp();

const db = getFirestore();

type Status = "active" | "inactive" | "sold_out";

interface MenuVariant {
  id: string;
  productId: string;
  label: string;
  unitQuantity: number;
  priceCents: number;
  minimumQuantity: number;
  active: boolean;
  sortOrder: number;
}

interface MenuProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  ingredients: string[];
  spiceLevel: "mild" | "medium" | "hot";
  allergyNotice: string;
  imageUrl: string;
  status: Status;
  bulkMenuEnabled: boolean;
  showWhenSoldOut: boolean;
  variants: MenuVariant[];
  sortOrder: number;
}

interface OrderDraft {
  fulfillmentType: "scheduled_pickup" | "event_pickup";
  availabilityWindowId: string;
  items: Array<{ productId: string; variantId: string; quantity: number }>;
  customer: {
    name: string;
    mobile: string;
    email: string;
    preferredContact: "text" | "phone" | "email";
    notes: string;
  };
  bulk: Record<string, unknown>;
  idempotencyKey: string;
  vendorSessionToken?: string;
}

const defaultBusiness = {
  id: "default",
  name: "Bangin Bustos Tamales",
  shortName: "Bangin Bustos",
  timezone: "America/Denver",
  orderPolicy: "Order requests are reviewed by the owner before they are final.",
  paymentPolicy: "Payment is collected after confirmation.",
  contactPhone: "(720) 555-0186",
  contactEmail: "orders@banginbustos.example",
  instagramHandle: "@banginbustostamales",
  taxRateBps: 870
};

function json(res: Parameters<Parameters<typeof onRequest>[0]>[1], body: unknown, status = 200) {
  res.status(status).set("cache-control", "no-store").json(body);
}

function normalize(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
}

async function getDoc<T extends object>(collection: string, id: string, fallback?: T) {
  const snap = await db.collection(collection).doc(id).get();
  if (!snap.exists) return fallback ?? null;
  return normalize({ id: snap.id, ...snap.data() }) as T;
}

async function listDocs<T extends object>(collection: string) {
  const snap = await db.collection(collection).get();
  return snap.docs.map((doc) => normalize({ id: doc.id, ...doc.data() }) as T);
}

async function getMenuProducts() {
  const [items, variants] = await Promise.all([
    listDocs<Omit<MenuProduct, "variants">>("menuItems"),
    listDocs<MenuVariant>("menuVariants")
  ]);
  return items
    .map((item) => ({
      ...item,
      variants: variants
        .filter((variant) => variant.productId === item.id)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    }))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

async function requireAdmin(req: Parameters<Parameters<typeof onRequest>[0]>[0]) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token) return null;
  const decoded = await getAuth().verifyIdToken(token);
  return decoded.admin === true ? decoded : null;
}

function canSelectWindow(window: Record<string, unknown>) {
  return (
    window.active === true &&
    new Date(String(window.cutoffAtUtc)).getTime() > Date.now() &&
    Number(window.committedOrders ?? 0) < Number(window.capacity ?? 0)
  );
}

function buildPaymentSettings() {
  return getDoc("paymentSettings", "default", {
    id: "default",
    cashAppCashtag: "BanginBustos",
    paypalMe: "banginbustos",
    venmoHandle: "banginbustos",
    zelleContact: "orders@banginbustos.example",
    applePayEnabled: false,
    applePayNote: "Apple Pay needs a merchant/payment-service setup before live use."
  });
}

async function createOrder(draft: OrderDraft) {
  const [products, settings, windows] = await Promise.all([
    getMenuProducts(),
    getDoc("businessSettings", "default", defaultBusiness),
    listDocs<Record<string, unknown>>("availabilityWindows")
  ]);
  const window = windows.find((item) => item.id === draft.availabilityWindowId);
  if (!window || !canSelectWindow(window)) throw new Error("Selected pickup window is unavailable.");

  const lines = draft.items
    .filter((item) => item.quantity > 0)
    .map((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      if (!product || product.status !== "active") throw new Error("Menu item is unavailable.");
      const variant = product.variants.find((entry) => entry.id === item.variantId);
      if (!variant || !variant.active) throw new Error("Package is unavailable.");
      return {
        productId: product.id,
        variantId: variant.id,
        productName: product.name,
        variantLabel: variant.label,
        unitQuantity: variant.unitQuantity,
        unitPriceCents: variant.priceCents,
        quantity: item.quantity,
        lineTotalCents: variant.priceCents * item.quantity
      };
    });

  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const taxCents = Math.round((subtotalCents * Number(settings?.taxRateBps ?? 0)) / 10000);
  const now = new Date().toISOString();
  const id = `ord_${draft.idempotencyKey}`;
  const order = {
    id,
    orderNumber: `BBT-${new Date().getFullYear()}-${draft.idempotencyKey.slice(-5).toUpperCase()}`,
    publicToken: `pub_${draft.idempotencyKey.replaceAll("-", "")}`,
    status: "new",
    paymentStatus: "unpaid",
    fulfillmentType: draft.fulfillmentType,
    availabilityWindowId: draft.availabilityWindowId,
    customer: draft.customer,
    bulk: draft.bulk,
    items: lines,
    totals: {
      subtotalCents,
      taxCents,
      feeCents: 0,
      totalCents: subtotalCents + taxCents
    },
    createdAtUtc: now,
    updatedAtUtc: now,
    privateNotes: "",
    vendorSessionToken: draft.vendorSessionToken ?? null
  };
  await db.collection("orders").doc(id).set(order, { merge: false });
  const { privateNotes, ...publicOrder } = order;
  void privateNotes;
  return publicOrder;
}

async function route(req: Parameters<Parameters<typeof onRequest>[0]>[0], res: Parameters<Parameters<typeof onRequest>[0]>[1]) {
  const url = new URL(req.url, "https://firebase.local");
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const method = req.method.toUpperCase();

  try {
    if (method === "GET" && path === "/public/business") return json(res, await getDoc("businessSettings", "default", defaultBusiness));
    if (method === "GET" && path === "/public/menu") {
      const products = await getMenuProducts();
      return json(
        res,
        products.filter((product) => product.bulkMenuEnabled !== false && (product.status === "active" || product.showWhenSoldOut))
      );
    }
    if (method === "GET" && path === "/public/availability") {
      const windows = await listDocs<Record<string, unknown>>("availabilityWindows");
      return json(res, windows.map((window) => ({ ...window, selectable: canSelectWindow(window) })));
    }
    if (method === "POST" && path === "/public/orders") return json(res, await createOrder(req.body as OrderDraft));
    if (method === "POST" && path === "/public/contacts") {
      const id = `contact_${Date.now()}`;
      await db.collection("contactSubmissions").doc(id).set({
        id,
        ...(req.body as object),
        createdAtUtc: new Date().toISOString()
      });
      return json(res, { ok: true, id });
    }
    const publicOrderMatch = path.match(/^\/public\/orders\/([^/]+)$/);
    if (method === "GET" && publicOrderMatch) {
      const snap = await db.collection("orders").where("publicToken", "==", publicOrderMatch[1]).limit(1).get();
      if (snap.empty) return json(res, { error: "Order not found." }, 404);
      const order = normalize({ id: snap.docs[0].id, ...snap.docs[0].data() }) as Record<string, unknown>;
      delete order.id;
      delete order.privateNotes;
      return json(res, order);
    }
    const publicVendorMatch = path.match(/^\/public\/vendor\/([^/]+)$/);
    if (method === "GET" && publicVendorMatch) {
      const snap = await db.collection("vendorSessions").where("publicToken", "==", publicVendorMatch[1]).where("active", "==", true).limit(1).get();
      if (snap.empty) return json(res, { error: "Vendor session not found." }, 404);
      return json(res, normalize({ id: snap.docs[0].id, ...snap.docs[0].data() }));
    }

    if (path.startsWith("/admin")) {
      const admin = await requireAdmin(req);
      if (!admin) return json(res, { error: "Not authorized." }, 403);

      if (method === "GET" && path === "/admin/dashboard") {
        const [orders, availabilityWindows, vendorSessions] = await Promise.all([
          listDocs("orders"),
          listDocs("availabilityWindows"),
          listDocs("vendorSessions")
        ]);
        return json(res, { orders, availabilityWindows, vendorSessions, admin: { email: admin.email } });
      }
      if (method === "GET" && path === "/admin/orders") return json(res, await listDocs("orders"));
      if (method === "GET" && path === "/admin/menu") return json(res, await getMenuProducts());
      if (method === "GET" && path === "/admin/availability") return json(res, await listDocs("availabilityWindows"));
      if (method === "GET" && path === "/admin/vendor-sessions") return json(res, await listDocs("vendorSessions"));
      if (method === "GET" && path === "/admin/contacts") return json(res, await listDocs("contactSubmissions"));
      if (method === "GET" && path === "/admin/payment-settings") return json(res, await buildPaymentSettings());
      if (method === "PATCH" && path === "/admin/payment-settings") {
        await db.collection("paymentSettings").doc("default").set(req.body as object, { merge: true });
        return json(res, await buildPaymentSettings());
      }
      if (method === "POST" && path === "/admin/menu") {
        const product = req.body as MenuProduct;
        const { variants, ...item } = product;
        await db.collection("menuItems").doc(product.id).set(item, { merge: true });
        await Promise.all(variants.map((variant) => db.collection("menuVariants").doc(variant.id).set({ ...variant, productId: product.id }, { merge: true })));
        return json(res, product);
      }
      const menuMatch = path.match(/^\/admin\/menu\/([^/]+)$/);
      if (menuMatch && method === "PATCH") {
        const product = req.body as Partial<MenuProduct>;
        const { variants, ...item } = product;
        await db.collection("menuItems").doc(menuMatch[1]).set(item, { merge: true });
        if (variants) {
          await Promise.all(variants.map((variant) => db.collection("menuVariants").doc(variant.id).set({ ...variant, productId: menuMatch[1] }, { merge: true })));
        }
        return json(res, { ok: true });
      }
      if (menuMatch && method === "DELETE") {
        await db.collection("menuItems").doc(menuMatch[1]).delete();
        const variants = await db.collection("menuVariants").where("productId", "==", menuMatch[1]).get();
        await Promise.all(variants.docs.map((doc) => doc.ref.delete()));
        return json(res, { ok: true });
      }
      const orderMatch = path.match(/^\/admin\/orders\/([^/]+)$/);
      if (orderMatch && method === "PATCH") {
        await db.collection("orders").doc(orderMatch[1]).set({ ...(req.body as object), updatedAtUtc: new Date().toISOString() }, { merge: true });
        return json(res, normalize({ id: orderMatch[1], ...(await db.collection("orders").doc(orderMatch[1]).get()).data() }));
      }
      if (method === "GET" && path === "/admin/exports/orders") {
        const orders = await listDocs<Record<string, unknown>>("orders");
        const csv = `orderNumber,customerName,status,paymentStatus,totalCents\n${orders
          .map((order) => [order.orderNumber, JSON.stringify((order.customer as { name?: string })?.name ?? ""), order.status, order.paymentStatus, (order.totals as { totalCents?: number })?.totalCents ?? 0].join(","))
          .join("\n")}\n`;
        res.status(200).set("content-type", "text/csv; charset=utf-8").send(csv);
        return;
      }
    }

    json(res, { error: "Not found." }, 404);
  } catch (error) {
    json(res, { error: error instanceof Error ? error.message : "Request failed." }, 400);
  }
}

export const api = onRequest({ region: "us-central1" }, route);

export const setAdminClaim = onRequest({ region: "us-central1" }, async (req, res) => {
  const token = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice("Bearer ".length)
    : "";
  if (!token) return json(res, { error: "Not authorized." }, 403);
  const decoded = await getAuth().verifyIdToken(token);
  if (decoded.admin !== true) return json(res, { error: "Not authorized." }, 403);
  const email = String(req.body?.email ?? "");
  if (!email) return json(res, { error: "Email is required." }, 400);
  const user = await getAuth().getUserByEmail(email);
  await getAuth().setCustomUserClaims(user.uid, { admin: true });
  await db.collection("adminAudit").add({
    action: "setAdminClaim",
    targetEmail: email,
    actorEmail: decoded.email ?? null,
    createdAt: FieldValue.serverTimestamp()
  });
  return json(res, { ok: true });
});
