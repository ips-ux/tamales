import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "./components/SiteHeader";
import { PosModeHeader } from "./components/PosModeHeader";
import { AdminGate } from "./components/AdminGate";
import { AboutPage } from "./pages/AboutPage";
import { AdminPage } from "./pages/AdminPage";
import { ConfirmationPage } from "./pages/ConfirmationPage";
import { HomePage } from "./pages/HomePage";
import { LegalPage } from "./pages/LegalPage";
import { LoginPage } from "./pages/LoginPage";
import { OrderPage } from "./pages/OrderPage";
import { UpdatesPage } from "./pages/UpdatesPage";
import { VendorPage } from "./pages/VendorPage";

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
  const isVendor = route.startsWith("/vendor/");
  const confirmationToken = route.match(/^\/order\/confirmation\/([^/]+)$/)?.[1];
  const vendorToken = route.match(/^\/vendor\/([^/]+)$/)?.[1];

  let page = <HomePage />;
  if (route === "/order") page = <OrderPage />;
  else if (confirmationToken) page = <ConfirmationPage publicToken={confirmationToken} />;
  else if (route === "/about") page = <AboutPage />;
  else if (route === "/login") page = <LoginPage />;
  else if (route === "/updates") page = <UpdatesPage />;
  else if (route === "/privacy") page = <LegalPage kind="privacy" />;
  else if (route === "/terms") page = <LegalPage kind="terms" />;
  else if (isVendor && vendorToken) page = <VendorPage sessionToken={vendorToken} />;
  else if (isAdmin) {
    page = (
      <AdminGate>
        <AdminPage path={route} />
      </AdminGate>
    );
  }

  return (
    <>
      {!isVendor &&
        (isPosMode ? <PosModeHeader path={route} /> : <SiteHeader isAdmin={isAdmin} />)}
      {page}
    </>
  );
}
