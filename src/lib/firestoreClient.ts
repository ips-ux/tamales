import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  increment,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type WriteBatch
} from "firebase/firestore";
import { firebaseConfigured, getCurrentUser, getFirebaseApp } from "./firebaseClient";
import type { MenuProduct, MenuVariant, PosTicketItem } from "./types";

export type PosPaymentMethod =
  | "cash"
  | "cashapp"
  | "paypal"
  | "venmo"
  | "zelle"
  | "applepay";

export interface NewPosTicket {
  items: PosTicketItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PosPaymentMethod;
  /** Practice/demo sales; kept out of real reporting. */
  isTest: boolean;
}

export interface PosTicketRecord extends NewPosTicket {
  id: string;
  ticketNumber: string;
  status: "paid" | "void";
  soldByEmail: string | null;
  createdAtUtc: string;
}

const POS_COLLECTION = "posTickets";

// A single Firestore instance with an on-device cache. The cache lets the POS
// keep ringing up and reading recent sales with no signal, syncing when back
// online — essential for selling at markets. initializeFirestore can only run
// once per app; fall back to getFirestore if it was already created (e.g. HMR).
let dbInstance: Firestore | null = null;
function db(): Firestore {
  const app = getFirebaseApp();
  if (!dbInstance) {
    try {
      dbInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
      });
    } catch {
      dbInstance = getFirestore(app);
    }
  }
  return dbInstance;
}

// ---------------------------------------------------------------------------
// Menu items. The canonical menu lives in the menuItems collection (publicly
// readable so the customer site renders it; owner-only writes). The fixture
// menu in src/data/fixtures.ts is only a starter template used to seed this
// collection once and as an offline/unconfigured fallback.
// ---------------------------------------------------------------------------

const MENU_COLLECTION = "menuItems";

export function watchMenuItems(
  onData: (products: MenuProduct[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const menuQuery = query(collection(db(), MENU_COLLECTION), orderBy("sortOrder"));
  return onSnapshot(
    menuQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            name: (data.name as string) ?? "",
            slug: (data.slug as string) ?? docSnapshot.id,
            description: (data.description as string) ?? "",
            ingredients: Array.isArray(data.ingredients) ? (data.ingredients as string[]) : [],
            spiceLevel: (data.spiceLevel as MenuProduct["spiceLevel"]) ?? "mild",
            allergyNotice: (data.allergyNotice as string) ?? "",
            imageUrl: (data.imageUrl as string) ?? "/media/tamales_hero.webp",
            singlePriceCents: (data.singlePriceCents as number) ?? 0,
            status: (data.status as MenuProduct["status"]) ?? "active",
            bulkMenuEnabled: Boolean(data.bulkMenuEnabled),
            showWhenSoldOut: Boolean(data.showWhenSoldOut),
            sortOrder: (data.sortOrder as number) ?? 0,
            variants: Array.isArray(data.variants) ? (data.variants as MenuVariant[]) : []
          } satisfies MenuProduct;
        })
      );
    },
    (error) => onError(error)
  );
}

export async function saveMenuItem(product: MenuProduct): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  const { id, ...data } = product;
  await setDoc(doc(db(), MENU_COLLECTION, id), {
    ...data,
    updatedAtUtc: new Date().toISOString()
  });
}

export async function deleteMenuItem(id: string): Promise<void> {
  await deleteDoc(doc(db(), MENU_COLLECTION, id));
}

/**
 * One-time migration: copies the starter menu into Firestore the first time
 * an admin loads the owner area with an empty menuItems collection. Returns
 * true when it seeded.
 */
export async function seedMenuItemsIfEmpty(products: MenuProduct[]): Promise<boolean> {
  if (!firebaseConfigured()) return false;
  const database = db();
  const existing = await getDocs(query(collection(database, MENU_COLLECTION), limit(1)));
  if (!existing.empty) return false;
  const batch = writeBatch(database);
  for (const product of products) {
    const { id, ...data } = product;
    batch.set(doc(database, MENU_COLLECTION, id), data);
  }
  await batch.commit();
  return true;
}

const INVENTORY_COLLECTION = "inventory";

// Applies a stock movement for every line on a ticket: -1 when items leave
// inventory (a sale), +1 when they come back (void, delete, edit-down).
// setDoc+increment upserts, so items without a tracked level start from 0.
function applyStockChange(
  batch: WriteBatch,
  database: Firestore,
  items: PosTicketItem[],
  direction: 1 | -1
) {
  for (const item of items) {
    if (item.quantity === 0) continue;
    batch.set(
      doc(database, INVENTORY_COLLECTION, item.productId),
      {
        productId: item.productId,
        productName: item.productName,
        stockCount: increment(direction * item.quantity),
        updatedAtUtc: new Date().toISOString()
      },
      { merge: true }
    );
  }
}

export async function savePosTicket(
  input: NewPosTicket
): Promise<{ id: string; ticketNumber: string }> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  const user = getCurrentUser();
  const now = new Date();
  const ticketNumber = buildTicketNumber(now);
  const database = db();
  const batch = writeBatch(database);
  const ticketRef = doc(collection(database, POS_COLLECTION));
  batch.set(ticketRef, {
    ...input,
    status: "paid",
    ticketNumber,
    soldByEmail: user?.email ?? null,
    soldByUid: user?.uid ?? null,
    createdAtUtc: now.toISOString()
  });
  // Practice sales never touch real stock.
  if (!input.isTest) {
    applyStockChange(batch, database, input.items, -1);
  }
  await batch.commit();
  return { id: ticketRef.id, ticketNumber };
}

export function watchPosTickets(
  onData: (tickets: PosTicketRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local."));
    return () => undefined;
  }
  // Order by the client-written ISO timestamp (always present, sortable) so
  // newly-added tickets appear immediately without waiting on a server value.
  const ticketsQuery = query(
    collection(db(), POS_COLLECTION),
    orderBy("createdAtUtc", "desc")
  );
  return onSnapshot(
    ticketsQuery,
    (snapshot) => {
      const tickets = snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data();
        return {
          id: docSnapshot.id,
          ticketNumber: (data.ticketNumber as string) ?? docSnapshot.id,
          items: (data.items as PosTicketItem[]) ?? [],
          subtotalCents: (data.subtotalCents as number) ?? 0,
          taxCents: (data.taxCents as number) ?? 0,
          totalCents: (data.totalCents as number) ?? 0,
          paymentMethod: (data.paymentMethod as PosPaymentMethod) ?? "cash",
          isTest: Boolean(data.isTest),
          status: (data.status as "paid" | "void") ?? "paid",
          soldByEmail: (data.soldByEmail as string | null) ?? null,
          createdAtUtc: (data.createdAtUtc as string) ?? new Date().toISOString()
        } satisfies PosTicketRecord;
      });
      onData(tickets);
    },
    (error) => onError(error)
  );
}

// The owner-editable subset of business settings, stored as a single public
// document so the customer site shows current contact info and the POS charges
// the current tax rate.
export interface EditableBusinessSettings {
  timezone: string;
  taxRateBps: number;
  contactPhone: string;
  contactEmail: string;
  instagramHandle: string;
}

const SETTINGS_COLLECTION = "settings";
const BUSINESS_SETTINGS_DOC = "business";

export function watchStoredBusinessSettings(
  onData: (settings: Partial<EditableBusinessSettings>) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  return onSnapshot(
    doc(db(), SETTINGS_COLLECTION, BUSINESS_SETTINGS_DOC),
    (snapshot) => {
      const data = snapshot.data();
      if (!data) {
        onData({});
        return;
      }
      const settings: Partial<EditableBusinessSettings> = {};
      if (typeof data.timezone === "string" && data.timezone) settings.timezone = data.timezone;
      if (typeof data.taxRateBps === "number" && data.taxRateBps >= 0) {
        settings.taxRateBps = data.taxRateBps;
      }
      if (typeof data.contactPhone === "string") settings.contactPhone = data.contactPhone;
      if (typeof data.contactEmail === "string") settings.contactEmail = data.contactEmail;
      if (typeof data.instagramHandle === "string") settings.instagramHandle = data.instagramHandle;
      onData(settings);
    },
    (error) => onError(error)
  );
}

export async function saveBusinessSettings(settings: EditableBusinessSettings): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  await setDoc(doc(db(), SETTINGS_COLLECTION, BUSINESS_SETTINGS_DOC), settings, { merge: true });
}

// Payment accounts the POS QR checkout charges to. Owner-only (rules) since
// only the signed-in POS reads them.
export interface EditablePaymentSettings {
  cashAppCashtag: string;
  paypalMe: string;
  venmoHandle: string;
  zelleContact: string;
  applePayEnabled: boolean;
  applePayNote: string;
}

const PAYMENT_SETTINGS_DOC = "payments";

export function watchPaymentSettings(
  onData: (settings: Partial<EditablePaymentSettings>) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  return onSnapshot(
    doc(db(), SETTINGS_COLLECTION, PAYMENT_SETTINGS_DOC),
    (snapshot) => {
      const data = snapshot.data();
      if (!data) {
        onData({});
        return;
      }
      const settings: Partial<EditablePaymentSettings> = {};
      if (typeof data.cashAppCashtag === "string") settings.cashAppCashtag = data.cashAppCashtag;
      if (typeof data.paypalMe === "string") settings.paypalMe = data.paypalMe;
      if (typeof data.venmoHandle === "string") settings.venmoHandle = data.venmoHandle;
      if (typeof data.zelleContact === "string") settings.zelleContact = data.zelleContact;
      if (typeof data.applePayEnabled === "boolean") settings.applePayEnabled = data.applePayEnabled;
      if (typeof data.applePayNote === "string") settings.applePayNote = data.applePayNote;
      onData(settings);
    },
    (error) => onError(error)
  );
}

export async function savePaymentSettings(settings: EditablePaymentSettings): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  await setDoc(doc(db(), SETTINGS_COLLECTION, PAYMENT_SETTINGS_DOC), settings, { merge: true });
}

export interface PosTicketUpdate {
  items: PosTicketItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: PosPaymentMethod;
}

export async function updatePosTicket(
  ticket: PosTicketRecord,
  updates: PosTicketUpdate
): Promise<void> {
  const database = db();
  const batch = writeBatch(database);
  batch.update(doc(database, POS_COLLECTION, ticket.id), {
    ...updates,
    updatedAtUtc: new Date().toISOString()
  });
  // Reconcile stock with the net item changes (paid, non-test tickets only):
  // quantities that went down come back into stock, increases leave it.
  if (!ticket.isTest && ticket.status === "paid") {
    const deltas = new Map<string, PosTicketItem>();
    for (const item of ticket.items) {
      deltas.set(item.productId, { ...item });
    }
    for (const item of updates.items) {
      const existing = deltas.get(item.productId);
      if (existing) {
        existing.quantity -= item.quantity;
      } else {
        deltas.set(item.productId, { ...item, quantity: -item.quantity });
      }
    }
    applyStockChange(
      batch,
      database,
      [...deltas.values()].filter((item) => item.quantity !== 0),
      1
    );
  }
  await batch.commit();
}

/** Void keeps the ticket for the audit trail but drops it out of all reporting. */
export async function setPosTicketStatus(
  ticket: PosTicketRecord,
  status: "paid" | "void"
): Promise<void> {
  if (ticket.status === status) return;
  const database = db();
  const batch = writeBatch(database);
  batch.update(doc(database, POS_COLLECTION, ticket.id), {
    status,
    updatedAtUtc: new Date().toISOString()
  });
  if (!ticket.isTest) {
    // Voiding puts the items back in stock; restoring takes them out again.
    applyStockChange(batch, database, ticket.items, status === "void" ? 1 : -1);
  }
  await batch.commit();
}

export async function deletePosTicket(ticket: PosTicketRecord): Promise<void> {
  const database = db();
  const batch = writeBatch(database);
  batch.delete(doc(database, POS_COLLECTION, ticket.id));
  // A voided ticket already returned its stock when it was voided.
  if (!ticket.isTest && ticket.status === "paid") {
    applyStockChange(batch, database, ticket.items, 1);
  }
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Inventory: live stock levels per menu item plus an adjustment audit log.
// Sales/voids/edits move stock automatically; the Settings → Inventory tab
// records manual movements (restocks, loss, comps, count corrections).
// ---------------------------------------------------------------------------

export interface InventoryLevel {
  productId: string;
  productName: string;
  stockCount: number;
  updatedAtUtc: string;
}

export function watchInventory(
  onData: (levels: InventoryLevel[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  return onSnapshot(
    collection(db(), INVENTORY_COLLECTION),
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            productId: docSnapshot.id,
            productName: (data.productName as string) ?? docSnapshot.id,
            stockCount: (data.stockCount as number) ?? 0,
            updatedAtUtc: (data.updatedAtUtc as string) ?? new Date().toISOString()
          } satisfies InventoryLevel;
        })
      );
    },
    (error) => onError(error)
  );
}

export type InventoryAdjustmentReason = "restock" | "loss" | "comp" | "correction";

export interface NewInventoryAdjustment {
  productId: string;
  productName: string;
  /** Signed stock movement: positive adds to stock, negative removes. */
  delta: number;
  reason: InventoryAdjustmentReason;
  note: string;
}

export interface InventoryAdjustmentRecord extends NewInventoryAdjustment {
  id: string;
  createdAtUtc: string;
}

const INVENTORY_ADJUSTMENTS_COLLECTION = "inventoryAdjustments";

export async function adjustInventory(input: NewInventoryAdjustment): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error("The adjustment quantity must be a whole number.");
  }
  const database = db();
  const batch = writeBatch(database);
  batch.set(
    doc(database, INVENTORY_COLLECTION, input.productId),
    {
      productId: input.productId,
      productName: input.productName,
      stockCount: increment(input.delta),
      updatedAtUtc: new Date().toISOString()
    },
    { merge: true }
  );
  batch.set(doc(collection(database, INVENTORY_ADJUSTMENTS_COLLECTION)), {
    ...input,
    createdAtUtc: new Date().toISOString()
  });
  await batch.commit();
}

export function watchInventoryAdjustments(
  onData: (adjustments: InventoryAdjustmentRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const adjustmentsQuery = query(
    collection(db(), INVENTORY_ADJUSTMENTS_COLLECTION),
    orderBy("createdAtUtc", "desc"),
    limit(50)
  );
  return onSnapshot(
    adjustmentsQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            productId: (data.productId as string) ?? "",
            productName: (data.productName as string) ?? "",
            delta: (data.delta as number) ?? 0,
            reason: (data.reason as InventoryAdjustmentReason) ?? "correction",
            note: (data.note as string) ?? "",
            createdAtUtc: (data.createdAtUtc as string) ?? new Date().toISOString()
          } satisfies InventoryAdjustmentRecord;
        })
      );
    },
    (error) => onError(error)
  );
}

// Global operating mode shared by every admin device. Stored in Firestore so
// flipping test mode on one phone flips it everywhere — never per-browser.
export interface AppState {
  testMode: boolean;
}

const APP_STATE_DOC = "app";

export function watchAppState(
  onData: (state: AppState) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  return onSnapshot(
    doc(db(), SETTINGS_COLLECTION, APP_STATE_DOC),
    (snapshot) => {
      const data = snapshot.data() ?? {};
      onData({ testMode: Boolean(data.testMode) });
    },
    (error) => onError(error)
  );
}

export async function saveTestMode(testMode: boolean): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  await setDoc(doc(db(), SETTINGS_COLLECTION, APP_STATE_DOC), { testMode }, { merge: true });
}

// Emails collected from the post-checkout receipt drawer. Doubles as the
// marketing list: marketingOptIn records the customer's consent checkbox.
export interface NewReceiptContact {
  email: string;
  marketingOptIn: boolean;
  ticketId: string;
  ticketNumber: string;
  totalCents: number;
  isTest: boolean;
}

export interface ReceiptContactRecord extends NewReceiptContact {
  id: string;
  createdAtUtc: string;
}

const RECEIPT_CONTACTS_COLLECTION = "receiptContacts";

export async function addReceiptContact(input: NewReceiptContact): Promise<string> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  const ref = await addDoc(collection(db(), RECEIPT_CONTACTS_COLLECTION), {
    ...input,
    email: input.email.trim().toLowerCase(),
    createdAtUtc: new Date().toISOString()
  });
  return ref.id;
}

export function watchReceiptContacts(
  onData: (contacts: ReceiptContactRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const contactsQuery = query(
    collection(db(), RECEIPT_CONTACTS_COLLECTION),
    orderBy("createdAtUtc", "desc")
  );
  return onSnapshot(
    contactsQuery,
    (snapshot) => {
      const contacts = snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data();
        return {
          id: docSnapshot.id,
          email: (data.email as string) ?? "",
          marketingOptIn: Boolean(data.marketingOptIn),
          ticketId: (data.ticketId as string) ?? "",
          ticketNumber: (data.ticketNumber as string) ?? "",
          totalCents: (data.totalCents as number) ?? 0,
          isTest: Boolean(data.isTest),
          createdAtUtc: (data.createdAtUtc as string) ?? new Date().toISOString()
        } satisfies ReceiptContactRecord;
      });
      onData(contacts);
    },
    (error) => onError(error)
  );
}

// Self-service marketing signups from the public /updates landing page (the
// second-chance CTA at the bottom of receipt emails points there). Signing up
// is implicit opt-in. Public create-only; rules validate the exact shape.
export interface MarketingSignupRecord {
  id: string;
  email: string;
  source: string;
  createdAtUtc: string;
}

const MARKETING_SIGNUPS_COLLECTION = "marketingSignups";

export async function addMarketingSignup(email: string): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Signups are not available right now. Please try again later.");
  }
  await addDoc(collection(db(), MARKETING_SIGNUPS_COLLECTION), {
    email: email.trim().toLowerCase(),
    source: "landing",
    createdAtUtc: new Date().toISOString()
  });
}

export function watchMarketingSignups(
  onData: (signups: MarketingSignupRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const signupsQuery = query(
    collection(db(), MARKETING_SIGNUPS_COLLECTION),
    orderBy("createdAtUtc", "desc")
  );
  return onSnapshot(
    signupsQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            email: (data.email as string) ?? "",
            source: (data.source as string) ?? "landing",
            createdAtUtc: (data.createdAtUtc as string) ?? new Date().toISOString()
          } satisfies MarketingSignupRecord;
        })
      );
    },
    (error) => onError(error)
  );
}

/**
 * Permanently deletes every POS ticket and receipt contact flagged isTest.
 * Real data is never touched — the queries filter on the flag, not on the
 * current mode. Returns how many documents were removed.
 */
export async function deleteAllTestTickets(): Promise<number> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  const database = db();
  const snapshots = await Promise.all([
    getDocs(query(collection(database, POS_COLLECTION), where("isTest", "==", true))),
    getDocs(query(collection(database, RECEIPT_CONTACTS_COLLECTION), where("isTest", "==", true)))
  ]);
  const docs = snapshots.flatMap((snapshot) => snapshot.docs);
  // Firestore batches cap at 500 operations.
  for (let start = 0; start < docs.length; start += 450) {
    const batch = writeBatch(database);
    for (const document of docs.slice(start, start + 450)) {
      batch.delete(document.ref);
    }
    await batch.commit();
  }
  return docs.length;
}

// ---------------------------------------------------------------------------
// Reporting: owner-only settings for accounting statements plus a lightweight
// expense ledger. Both are admin-only in Firestore rules.
// ---------------------------------------------------------------------------

export type FilingFrequency = "monthly" | "quarterly" | "annually";

export interface ReportingSettings {
  /** Admin's infrastructure revenue share, in basis points of net sales. */
  revenueShareBps: number;
  taxJurisdiction: string;
  taxAccountNumber: string;
  filingFrequency: FilingFrequency;
  cashOnHandCents: number;
  equipmentAssetsCents: number;
  otherAssetsCents: number;
  otherLiabilitiesCents: number;
  /** Sales tax already remitted to the state, all time. */
  taxRemittedToDateCents: number;
  /** Revenue share already paid out to the admin, all time. */
  adminSharePaidToDateCents: number;
}

export const reportingDefaults: ReportingSettings = {
  revenueShareBps: 1000,
  taxJurisdiction: "",
  taxAccountNumber: "",
  filingFrequency: "quarterly",
  cashOnHandCents: 0,
  equipmentAssetsCents: 0,
  otherAssetsCents: 0,
  otherLiabilitiesCents: 0,
  taxRemittedToDateCents: 0,
  adminSharePaidToDateCents: 0
};

const REPORTING_SETTINGS_DOC = "reporting";

export function watchReportingSettings(
  onData: (settings: ReportingSettings) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  return onSnapshot(
    doc(db(), SETTINGS_COLLECTION, REPORTING_SETTINGS_DOC),
    (snapshot) => {
      const data = snapshot.data() ?? {};
      const numeric = (value: unknown, fallback: number) =>
        typeof value === "number" && Number.isFinite(value) ? value : fallback;
      const text = (value: unknown, fallback: string) =>
        typeof value === "string" ? value : fallback;
      onData({
        revenueShareBps: numeric(data.revenueShareBps, reportingDefaults.revenueShareBps),
        taxJurisdiction: text(data.taxJurisdiction, ""),
        taxAccountNumber: text(data.taxAccountNumber, ""),
        filingFrequency: (["monthly", "quarterly", "annually"] as FilingFrequency[]).includes(
          data.filingFrequency as FilingFrequency
        )
          ? (data.filingFrequency as FilingFrequency)
          : reportingDefaults.filingFrequency,
        cashOnHandCents: numeric(data.cashOnHandCents, 0),
        equipmentAssetsCents: numeric(data.equipmentAssetsCents, 0),
        otherAssetsCents: numeric(data.otherAssetsCents, 0),
        otherLiabilitiesCents: numeric(data.otherLiabilitiesCents, 0),
        taxRemittedToDateCents: numeric(data.taxRemittedToDateCents, 0),
        adminSharePaidToDateCents: numeric(data.adminSharePaidToDateCents, 0)
      });
    },
    (error) => onError(error)
  );
}

export async function saveReportingSettings(settings: ReportingSettings): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  await setDoc(doc(db(), SETTINGS_COLLECTION, REPORTING_SETTINGS_DOC), settings, { merge: true });
}

export type ExpenseCategory =
  | "ingredients"
  | "supplies"
  | "packaging"
  | "equipment"
  | "fees"
  | "marketing"
  | "other";

export interface NewExpense {
  /** YYYY-MM-DD day key in the business timezone. */
  dateKey: string;
  category: ExpenseCategory;
  amountCents: number;
  note: string;
}

export interface ExpenseRecord extends NewExpense {
  id: string;
  createdAtUtc: string;
}

const EXPENSES_COLLECTION = "expenses";

export async function addExpense(input: NewExpense): Promise<string> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  const ref = await addDoc(collection(db(), EXPENSES_COLLECTION), {
    ...input,
    createdAtUtc: new Date().toISOString()
  });
  return ref.id;
}

export async function deleteExpense(id: string): Promise<void> {
  await deleteDoc(doc(db(), EXPENSES_COLLECTION, id));
}

export function watchExpenses(
  onData: (expenses: ExpenseRecord[]) => void,
  onError: (error: Error) => void
): () => void {
  if (!firebaseConfigured()) {
    onError(new Error("Firebase is not configured."));
    return () => undefined;
  }
  const expensesQuery = query(collection(db(), EXPENSES_COLLECTION), orderBy("dateKey", "desc"));
  return onSnapshot(
    expensesQuery,
    (snapshot) => {
      const expenses = snapshot.docs.map((docSnapshot) => {
        const data = docSnapshot.data();
        return {
          id: docSnapshot.id,
          dateKey: (data.dateKey as string) ?? "",
          category: (data.category as ExpenseCategory) ?? "other",
          amountCents: (data.amountCents as number) ?? 0,
          note: (data.note as string) ?? "",
          createdAtUtc: (data.createdAtUtc as string) ?? new Date().toISOString()
        } satisfies ExpenseRecord;
      });
      onData(expenses);
    },
    (error) => onError(error)
  );
}

function buildTicketNumber(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `POS-${day}-${time}`;
}
