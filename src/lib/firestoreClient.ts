import {
  addDoc,
  collection,
  doc,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  type Firestore
} from "firebase/firestore";
import { firebaseConfigured, getCurrentUser, getFirebaseApp } from "./firebaseClient";
import type { PosTicketItem } from "./types";

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

export async function savePosTicket(input: NewPosTicket): Promise<string> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  const user = getCurrentUser();
  const now = new Date();
  const ref = await addDoc(collection(db(), POS_COLLECTION), {
    ...input,
    status: "paid",
    ticketNumber: buildTicketNumber(now),
    soldByEmail: user?.email ?? null,
    soldByUid: user?.uid ?? null,
    createdAtUtc: now.toISOString()
  });
  return ref.id;
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

function buildTicketNumber(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `POS-${day}-${time}`;
}
