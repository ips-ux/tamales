import { useEffect, useMemo, useState } from "react";
import { SiteFooter } from "./components/SiteFooter";
import { SiteHeader } from "./components/SiteHeader";
import { PosModeHeader } from "./components/PosModeHeader";
import { AdminGate } from "./components/AdminGate";
import { AboutPage } from "./pages/AboutPage";
import { AdminPage } from "./pages/AdminPage";
import { ContactPage } from "./pages/ContactPage";
import { EventOrderPage } from "./pages/EventOrderPage";
import { HomePage } from "./pages/HomePage";
import { KioskPage } from "./pages/KioskPage";
import { LegalPage } from "./pages/LegalPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrderPage } from "./pages/OrderPage";
import { TrackerPage } from "./pages/TrackerPage";
import { UpdatesPage } from "./pages/UpdatesPage";

function usePathname() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const updatePath = () => setPath(window.location.pathname);
    window.addEventListener("popstate", updatePath);
    document.addEventListener("bbt:navigation", updatePath);
    return () => {
      window.removeEventListener("popstate", updatePath);
      document.removeEventListener("bbt:navigation", updatePath);
    };
  }, []);

  return path;
}

/** The decoded value of the 1 path part that `pattern` captures, or "". */
function pathParam(route: string, pattern: RegExp): string {
  const raw = route.match(pattern)?.[1];
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export function navigate(to: string) {
  window.history.pushState({}, "", to);
  document.dispatchEvent(new Event("bbt:navigation"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function App() {
  const path = usePathname();
  const route = useMemo(() => path.replace(/\/+$/, "") || "/", [path]);
  const isAdmin = route.startsWith("/admin");
  const isPosMode = route.startsWith("/admin/pos") || route.startsWith("/admin/orders");
  const eventId = pathParam(route, /^\/e\/([^/]+)$/);
  const trackerToken = pathParam(route, /^\/t\/([^/]+)$/);
  const kioskToken = pathParam(route, /^\/kiosk\/([^/]+)$/);

  // The kiosk has no header and no footer.
  if (kioskToken) return <KioskPage kioskToken={kioskToken} />;

  let page = <NotFoundPage />;
  if (route === "/") page = <HomePage />;
  else if (route === "/order") page = <OrderPage />;
  else if (eventId) page = <EventOrderPage key={eventId} eventId={eventId} />;
  else if (trackerToken) page = <TrackerPage key={trackerToken} trackerToken={trackerToken} />;
  else if (route === "/about") page = <AboutPage />;
  else if (route === "/contact") page = <ContactPage />;
  else if (route === "/login") page = <LoginPage />;
  else if (route === "/updates") page = <UpdatesPage />;
  else if (route === "/privacy") page = <LegalPage kind="privacy" />;
  else if (route === "/terms") page = <LegalPage kind="terms" />;
  else if (isAdmin) {
    page = (
      <AdminGate>
        <AdminPage path={route} />
      </AdminGate>
    );
  }

  // Admin has a header and no footer.
  if (isAdmin) {
    return (
      <>
        {isPosMode ? <PosModeHeader path={route} /> : <SiteHeader isAdmin />}
        {page}
      </>
    );
  }

  return (
    <div className="public-frame">
      <SiteHeader />
      {page}
      <SiteFooter />
    </div>
  );
}
