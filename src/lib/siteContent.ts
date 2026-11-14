// Owner-editable site text and photos (Admin > Site Content).
//
// Storage:
//   siteContent/main        one document, the fields of SiteContent below
//   siteImages/{slot}       one document for each fixed slot: { dataUrl, updatedAtUtc }
// Both are publicly readable and owner-writable (firebase/firestore.rules).
// An empty or missing field falls back to the default in this file, so the
// public site always has text to show.

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { firebaseConfigured } from "./firebaseClient";
import { db } from "./firestoreClient";

export interface HowItWorksStep {
  title: string;
  text: string;
}

export interface SiteContent {
  heroTagline: string;
  /** Exactly 3 short highlight chips. */
  heroChips: [string, string, string];
  aboutHeadline: string;
  /** Plain text. A blank line starts a new paragraph. */
  aboutStory: string;
  /** Exactly 3 steps. */
  howItWorks: [HowItWorksStep, HowItWorksStep, HowItWorksStep];
  orderPolicy: string;
  paymentPolicy: string;
  refundPolicy: string;
  allergenNotice: string;
  footerBlurb: string;
}

export const siteContentDefaults: SiteContent = {
  heroTagline: "Red and green tamales, made by hand in small batches. Order ahead or find us at a pop-up.",
  heroChips: ["Red chile", "Green chile", "Made by hand"],
  aboutHeadline: "Tamales made by hand.",
  aboutStory:
    "Bangin Bustos Tamales is a small Colorado kitchen. We make red and green tamales by hand, one batch at a time.\n\nYou can pre-order for a pop-up, request a batch for pickup or delivery, or order at our booth.",
  howItWorks: [
    { title: "Pick an event", text: "Select a pop-up, or request a batch for pickup or delivery." },
    { title: "Build your order", text: "Select red, green, or both. Set the quantity." },
    { title: "Pay and pick up", text: "We confirm your order. You pay online, then pick up hot tamales." }
  ],
  orderPolicy: "We confirm each pre-order and each batch request before we make it.",
  paymentPolicy: "You pay online after we confirm your order. We start the batch after we receive your payment.",
  refundPolicy: "We give a full refund until the pre-order cutoff. We give no refund after the cutoff.",
  allergenNotice:
    "Our tamales contain corn and can contain pork, dairy, and chile. We make all items in one kitchen. Tell us about a food allergy before you order.",
  footerBlurb: "Batch made. Pop-up fueled. Handmade in Colorado."
};

export type SiteImageSlot = "hero" | "about";

export const siteImageDefaults: Record<SiteImageSlot, string> = {
  hero: "/media/tamales_hero.webp",
  about: "/media/tamales_hero.webp"
};

/** Target size for a site image data URL (about 250 KB). Pass to ImagePicker. */
export const SITE_IMAGE_MAX_CHARS = 250_000;

const CONTENT_COLLECTION = "siteContent";
const CONTENT_DOC = "main";
const IMAGES_COLLECTION = "siteImages";

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/** Merges a stored document over the defaults. Exported for tests. */
export function mergeSiteContent(stored: Record<string, unknown> | undefined): SiteContent {
  const d = siteContentDefaults;
  if (!stored) return d;
  const chips = Array.isArray(stored.heroChips) ? stored.heroChips : [];
  const steps = Array.isArray(stored.howItWorks) ? stored.howItWorks : [];
  const step = (index: number): HowItWorksStep => {
    const raw = (steps[index] ?? {}) as Record<string, unknown>;
    return {
      title: text(raw.title, d.howItWorks[index].title),
      text: text(raw.text, d.howItWorks[index].text)
    };
  };
  return {
    heroTagline: text(stored.heroTagline, d.heroTagline),
    heroChips: [text(chips[0], d.heroChips[0]), text(chips[1], d.heroChips[1]), text(chips[2], d.heroChips[2])],
    aboutHeadline: text(stored.aboutHeadline, d.aboutHeadline),
    aboutStory: text(stored.aboutStory, d.aboutStory),
    howItWorks: [step(0), step(1), step(2)],
    orderPolicy: text(stored.orderPolicy, d.orderPolicy),
    paymentPolicy: text(stored.paymentPolicy, d.paymentPolicy),
    refundPolicy: text(stored.refundPolicy, d.refundPolicy),
    allergenNotice: text(stored.allergenNotice, d.allergenNotice),
    footerBlurb: text(stored.footerBlurb, d.footerBlurb)
  };
}

// One app-wide subscription for the text, one for each image slot that a
// screen uses. Same pattern as lib/businessSettings.ts.
let content: SiteContent = siteContentDefaults;
/** The raw stored document, so the editor can tell "empty" from "default". */
let storedContent: Record<string, unknown> = {};
let contentStarted = false;
const contentListeners = new Set<() => void>();

function ensureContentStarted() {
  if (contentStarted || !firebaseConfigured()) return;
  contentStarted = true;
  onSnapshot(
    doc(db(), CONTENT_COLLECTION, CONTENT_DOC),
    (snapshot) => {
      storedContent = snapshot.data() ?? {};
      content = mergeSiteContent(storedContent);
      contentListeners.forEach((listener) => listener());
    },
    () => {
      // Keep the defaults if the document is unreadable (offline, rules).
    }
  );
}

/** Site text with defaults applied. Safe to call on any public page. */
export function useSiteContent(): SiteContent {
  const [, setVersion] = useState(0);
  useEffect(() => {
    ensureContentStarted();
    const listener = () => setVersion((value) => value + 1);
    contentListeners.add(listener);
    return () => {
      contentListeners.delete(listener);
    };
  }, []);
  ensureContentStarted();
  return content;
}

/** The stored values only (no defaults), for the Site Content editor. */
export function useStoredSiteContent(): Record<string, unknown> {
  useSiteContent();
  return storedContent;
}

/**
 * Saves the editor fields. Pass an empty string for a field to make the site
 * use the default for that field.
 */
export async function saveSiteContent(values: SiteContent): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  await setDoc(doc(db(), CONTENT_COLLECTION, CONTENT_DOC), {
    ...values,
    updatedAtUtc: new Date().toISOString()
  });
}

const images: Partial<Record<SiteImageSlot, string>> = {};
const imageStarted = new Set<SiteImageSlot>();
const imageListeners = new Set<() => void>();

function ensureImageStarted(slot: SiteImageSlot) {
  if (imageStarted.has(slot) || !firebaseConfigured()) return;
  imageStarted.add(slot);
  onSnapshot(
    doc(db(), IMAGES_COLLECTION, slot),
    (snapshot) => {
      const dataUrl = snapshot.data()?.dataUrl;
      if (typeof dataUrl === "string" && dataUrl) images[slot] = dataUrl;
      else delete images[slot];
      imageListeners.forEach((listener) => listener());
    },
    () => undefined
  );
}

/** The image for a slot: the owner's photo, or the built-in default. */
export function useSiteImage(slot: SiteImageSlot): string {
  const [, setVersion] = useState(0);
  useEffect(() => {
    ensureImageStarted(slot);
    const listener = () => setVersion((value) => value + 1);
    imageListeners.add(listener);
    return () => {
      imageListeners.delete(listener);
    };
  }, [slot]);
  ensureImageStarted(slot);
  return images[slot] ?? siteImageDefaults[slot];
}

/** True when the owner has saved a photo for the slot. */
export function siteImageIsCustom(slot: SiteImageSlot): boolean {
  return Boolean(images[slot]);
}

/** Saves a photo for a slot. Pass an empty string to go back to the default photo. */
export async function saveSiteImage(slot: SiteImageSlot, dataUrl: string): Promise<void> {
  if (!firebaseConfigured()) {
    throw new Error("Firebase is not configured. Add VITE_FIREBASE values to .env.local.");
  }
  await setDoc(doc(db(), IMAGES_COLLECTION, slot), {
    dataUrl,
    updatedAtUtc: new Date().toISOString()
  });
}
