import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  Clock,
  CreditCard,
  Home,
  LayoutDashboard,
  ListChecks,
  LogIn,
  Menu,
  Settings,
  Store,
  UtensilsCrossed,
  Users,
  X,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState } from "react";
import { navigate } from "../App";
import { watchNewPreorderCount } from "../lib/firestoreClient";

interface SiteHeaderProps {
  isAdmin?: boolean;
}

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface NavGroup {
  label: string;
  links: NavLink[];
}

const publicLinks: NavLink[] = [
  { href: "/order", label: "Place an Order", icon: ClipboardList },
  { href: "/about", label: "About Me", icon: Home },
  { href: "/login", label: "Login", icon: LogIn }
];

// Live POS is deliberately not in here — it's the standout entry point
// rendered on its own, since stepping into it swaps to the bespoke POS shell.
const adminGroups: NavGroup[] = [
  {
    label: "Overview",
    links: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard }]
  },
  {
    label: "Sales",
    links: [
      { href: "/admin/preorders", label: "Pre-Orders", icon: CalendarDays },
      { href: "/admin/orders", label: "Orders", icon: ListChecks }
    ]
  },
  {
    label: "Catalog",
    links: [
      { href: "/admin/menu", label: "Menu", icon: UtensilsCrossed },
      { href: "/admin/availability", label: "Availability", icon: Clock }
    ]
  },
  {
    label: "Business",
    links: [
      { href: "/admin/vendor", label: "Vendor", icon: Store },
      { href: "/admin/contacts", label: "Contacts", icon: Users },
      { href: "/admin/settings", label: "Settings", icon: Settings },
      { href: "/admin/reports", label: "Reports", icon: BarChart3 }
    ]
  }
];

const livePosLink: NavLink = { href: "/admin/pos", label: "Live POS", icon: CreditCard };

export function SiteHeader({ isAdmin = false }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const [newPreorderCount, setNewPreorderCount] = useState(0);

  // Live badge for unacknowledged pre-orders. Only subscribed on admin
  // routes; permission/offline errors are swallowed and just show no badge,
  // matching how other admin watchers degrade (see AdminPage.tsx).
  useEffect(() => {
    if (!isAdmin) return;
    return watchNewPreorderCount(
      (count) => setNewPreorderCount(count),
      () => setNewPreorderCount(0)
    );
  }, [isAdmin]);

  function go(href: string) {
    setOpen(false);
    navigate(href);
  }

  return (
    <header className="site-header">
      <a
        className="brand-lockup"
        href="/"
        onClick={(event) => {
          event.preventDefault();
          navigate("/");
        }}
      >
        <img className="brand-logo" src="/media/logo1.webp" alt="Bangin Bustos Tamales" />
      </a>
      <button
        className="icon-button mobile-menu-button"
        type="button"
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={21} /> : <Menu size={21} />}
      </button>
      <nav className={open ? "site-nav site-nav-open" : "site-nav"} aria-label="Primary">
        {isAdmin ? (
          <>
            {adminGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label">{group.label}</span>
                <div className="nav-group-links">
                  {group.links.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={(event) => {
                        event.preventDefault();
                        go(link.href);
                      }}
                    >
                      <link.icon size={17} aria-hidden="true" />
                      {link.label}
                      {link.href === "/admin/preorders" && newPreorderCount > 0 && (
                        <span className="nav-badge">{newPreorderCount}</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
            <a
              className="nav-pos-cta"
              href={livePosLink.href}
              onClick={(event) => {
                event.preventDefault();
                go(livePosLink.href);
              }}
            >
              <CreditCard size={17} aria-hidden="true" />
              Live POS
            </a>
          </>
        ) : (
          publicLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => {
                event.preventDefault();
                go(link.href);
              }}
            >
              <link.icon size={17} aria-hidden="true" />
              {link.label}
            </a>
          ))
        )}
      </nav>
    </header>
  );
}
