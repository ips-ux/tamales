import { ClipboardList, Home, LogIn, Menu, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { navigate } from "../App";

interface SiteHeaderProps {
  isAdmin?: boolean;
}

interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

const publicLinks: NavLink[] = [
  { href: "/order", label: "Place an Order", icon: ClipboardList },
  { href: "/about", label: "About Me", icon: Home },
  { href: "/login", label: "Login", icon: LogIn }
];

const adminLinks: NavLink[] = [
  { href: "/admin", label: "Dashboard", icon: ShieldCheck },
  { href: "/admin/pos", label: "Live POS", icon: ClipboardList },
  { href: "/admin/orders", label: "Orders", icon: ShieldCheck },
  { href: "/admin/menu", label: "Menu", icon: ShieldCheck },
  { href: "/admin/availability", label: "Availability", icon: ShieldCheck },
  { href: "/admin/vendor", label: "Vendor", icon: ShieldCheck },
  { href: "/admin/contacts", label: "Contacts", icon: ShieldCheck },
  { href: "/admin/settings", label: "Settings", icon: ShieldCheck },
  { href: "/admin/exports", label: "Exports", icon: ShieldCheck }
];

export function SiteHeader({ isAdmin = false }: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const links = isAdmin ? adminLinks : publicLinks;

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
        <span className="brand-mark" aria-hidden="true">
          BB
        </span>
        <span>
          <strong>Bangin Bustos</strong>
          <small>Tamales</small>
        </span>
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
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => {
                event.preventDefault();
                setOpen(false);
                navigate(link.href);
              }}
            >
              <Icon size={17} aria-hidden="true" />
              {link.label}
            </a>
          );
        })}
      </nav>
    </header>
  );
}
