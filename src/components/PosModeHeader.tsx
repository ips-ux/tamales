import { ArrowLeft, CreditCard, ListChecks } from "lucide-react";
import { navigate } from "../App";

interface PosModeHeaderProps {
  path: string;
}

const posModeTabs = [
  { href: "/admin/pos", label: "Live POS", icon: CreditCard },
  { href: "/admin/orders", label: "Orders", icon: ListChecks }
];

// The bespoke shell a cashier lives in once they step into Live POS mode —
// deliberately stripped down to just the two tabs they need at the register,
// with one clear way back to the full owner backend.
export function PosModeHeader({ path }: PosModeHeaderProps) {
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
        Admin Backend
      </button>
    </header>
  );
}
