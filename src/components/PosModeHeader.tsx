import { ArrowLeft, CreditCard, ListChecks } from "lucide-react";
import { useEffect, useRef } from "react";
import { navigate } from "../App";
import { useLiveOrders } from "../lib/ordersStore";
import { businessDateKey, businessTodayKey } from "../lib/time";
import { armChime, findNewIds, playChime } from "./admin/liveAlert";
import { liveOrdersForDay } from "./admin/orderRules";

interface PosModeHeaderProps {
  path: string;
}

const posModeTabs = [
  { href: "/admin/pos", label: "Live POS", icon: CreditCard },
  { href: "/admin/orders", label: "Orders", icon: ListChecks }
];

/**
 * The alert for a new live order. This header is on each Live POS screen, so
 * the watcher runs on all of them. Returns the count for the Orders tab badge:
 * the live orders of today that the owner has not started.
 */
function useLiveOrderAlert(): number {
  const { orders, loading, failed } = useLiveOrders();
  const known = useRef<Set<string> | null>(null);

  useEffect(() => armChime(), []);

  useEffect(() => {
    // Wait for the first load, so the orders already there do not chime.
    if (loading || failed) return;
    const result = findNewIds(
      known.current,
      orders.map((order) => order.id)
    );
    known.current = result.known;
    if (result.fresh.length > 0) playChime();
  }, [orders, loading, failed]);

  return liveOrdersForDay(orders, businessTodayKey(), businessDateKey).filter(
    (order) => order.state === "received"
  ).length;
}

// The bespoke shell a cashier lives in once they step into Live POS mode —
// deliberately stripped down to just the two tabs they need at the register,
// with one clear way back to Admin.
export function PosModeHeader({ path }: PosModeHeaderProps) {
  const newOrderCount = useLiveOrderAlert();
  return (
    <header className="pos-mode-header">
      <span className="brand-chip" aria-hidden="true">
        <img src="/media/logo1.webp" alt="" />
      </span>
      <nav className="pos-mode-tabs" aria-label="Live POS">
        {posModeTabs.map((tab) => {
          const active = path.startsWith(tab.href);
          return (
            <a
              key={tab.href}
              className={active ? "pos-mode-tab pos-mode-tab-active" : "pos-mode-tab"}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              onClick={(event) => {
                event.preventDefault();
                navigate(tab.href);
              }}
            >
              <tab.icon size={18} aria-hidden="true" />
              {tab.label}
              {tab.href === "/admin/orders" && newOrderCount > 0 && (
                <span className="nav-badge pos-tab-badge" aria-label={`${newOrderCount} new`}>
                  {newOrderCount}
                </span>
              )}
            </a>
          );
        })}
      </nav>
      <button
        className="pos-mode-exit"
        type="button"
        onClick={() => navigate("/admin")}
      >
        <ArrowLeft size={18} aria-hidden="true" />
        Back to Admin
      </button>
    </header>
  );
}
