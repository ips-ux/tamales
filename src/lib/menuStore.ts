import { useEffect, useState } from "react";
import { menuProducts as starterMenu } from "../data/fixtures";
import { firebaseConfigured } from "./firebaseClient";
import { watchMenuItems } from "./firestoreClient";
import type { MenuProduct } from "./types";

// One app-wide subscription to the menuItems collection. The fixture starter
// menu is served until the remote menu loads (or when Firebase isn't
// configured), so every consumer can read synchronously. Once the owner's
// menu exists in Firestore, that is the single source of truth everywhere —
// admin, POS, and the customer site.
let current: MenuProduct[] = starterMenu;
let started = false;
const listeners = new Set<(products: MenuProduct[]) => void>();

function ensureStarted() {
  if (started || !firebaseConfigured()) return;
  started = true;
  watchMenuItems(
    (remote) => {
      current = remote.length > 0 ? remote : starterMenu;
      listeners.forEach((listener) => listener(current));
    },
    () => {
      // Keep serving the current menu if the snapshot fails (offline etc.).
    }
  );
}

export function getMenuProducts(): MenuProduct[] {
  ensureStarted();
  return current;
}

export function useMenuProducts(): MenuProduct[] {
  const [products, setProducts] = useState<MenuProduct[]>(getMenuProducts());

  useEffect(() => {
    setProducts(current);
    const listener = (next: MenuProduct[]) => setProducts(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return products;
}
