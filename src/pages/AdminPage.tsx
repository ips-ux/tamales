import {
  ArrowLeft,
  Ban,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Download,
  FlaskConical,
  KeyRound,
  Mail,
  MapPin,
  Package,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  Settings,
  Trash2,
  Users,
  X
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { navigate } from "../App";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { ImagePicker } from "../components/ImagePicker";
import { QRCodePanel } from "../components/QRCodePanel";
import { useAvailabilityWindows, usePickupLocations } from "../lib/availabilityStore";
import {
  contactSubmissions,
  menuProducts,
  availabilityWindows as starterAvailabilityWindows,
  paymentSettings as initialPaymentSettings,
  pickupLocations as starterPickupLocations,
  vendorSessions
} from "../data/fixtures";
import { useBusinessSettings } from "../lib/businessSettings";
import { downloadCsv } from "../lib/csv";
import { receiptEmailConfigured, sendReceiptEmail } from "../lib/emailReceipt";
import {
  addExpense,
  addReceiptContact,
  adjustInventory,
  deleteAllTestTickets,
  deleteAvailabilityWindow,
  deleteExpense,
  deleteMenuItem,
  deletePickupLocation,
  deletePosTicket,
  reportingDefaults,
  saveAvailabilityWindow,
  saveBusinessSettings,
  saveMenuItem,
  savePaymentSettings,
  savePickupLocation,
  savePosTicket,
  saveReportingSettings,
  saveTestMode,
  seedAvailabilityWindowsIfEmpty,
  seedMenuItemsIfEmpty,
  seedPickupLocationsIfEmpty,
  setPosTicketStatus,
  updateOrderStatus,
  updatePosTicket,
  watchOrders,
  watchAppState,
  watchExpenses,
  watchInventory,
  watchPaymentSettings,
  watchInventoryAdjustments,
  watchMarketingSignups,
  watchPosTickets,
  watchReceiptContacts,
  watchReportingSettings,
  type ExpenseCategory,
  type ExpenseRecord,
  type FilingFrequency,
  type InventoryAdjustmentReason,
  type InventoryAdjustmentRecord,
  type InventoryLevel,
  type MarketingSignupRecord,
  type PosPaymentMethod,
  type PosTicketRecord,
  type ReceiptContactRecord,
  type ReportingSettings
} from "../lib/firestoreClient";
import { useMenuProducts } from "../lib/menuStore";
import { formatMoney } from "../lib/money";
import { canTransitionOrder } from "../lib/order";
import {
  buildBalanceSheet,
  buildIncomeStatement,
  buildSalesTaxReport,
  expenseCategoryLabels,
  expensesInPeriod,
  getPeriods,
  periodRangeLabel,
  ticketsInPeriod,
  type Period,
  type PeriodId
} from "../lib/reports";
import {
  businessDateKey,
  businessTodayKey,
  formatBusinessDateTime,
  formatWindow,
  isWindowSelectable
} from "../lib/time";
import type {
  AvailabilityWindow,
  FulfillmentType,
  MenuProduct,
  MenuVariant,
  OrderRecord,
  OrderStatus,
  PaymentSettings,
  PickupLocation,
  PosTicketItem,
  ProductStatus,
  SpiceLevel
} from "../lib/types";

interface AdminPageProps {
  path: string;
}

type PaymentMethod = PosPaymentMethod;

interface PosState {
  tickets: PosTicketRecord[];
  loading: boolean;
  error: string | null;
}

const statusLabels: Record<OrderStatus, string> = {
  new: "New",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  canceled: "Canceled"
};

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Cash",
  cashapp: "Cash App",
  paypal: "PayPal",
  venmo: "Venmo",
  zelle: "Zelle",
  applepay: "Apple Pay"
};

function adminTitle(path: string) {
  if (path.includes("/pos")) return "Live POS";
  if (path.includes("/preorders")) return "Pre-Orders";
  if (path.includes("/orders")) return "Orders";
  if (path.includes("/menu")) return "Menu";
  if (path.includes("/availability")) return "Availability";
  if (path.includes("/vendor")) return "Vendor";
  if (path.includes("/contacts")) return "Contacts";
  if (path.includes("/settings")) return "Settings";
  if (path.includes("/reports") || path.includes("/exports")) return "Reports";
  return "Dashboard";
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function methodUrl(method: PaymentMethod, settings: PaymentSettings, cents: number) {
  const amount = (cents / 100).toFixed(2);
  const note = encodeURIComponent("Bangin Bustos Tamales POS ticket");
  if (method === "cash") return "";
  if (method === "cashapp") return `https://cash.app/$${settings.cashAppCashtag}/${amount}`;
  if (method === "paypal") return `https://paypal.me/${settings.paypalMe}/${amount}`;
  if (method === "venmo") {
    return `venmo://paycharge?txn=pay&recipients=${settings.venmoHandle}&amount=${amount}&note=${note}`;
  }
  if (method === "zelle") return `Zelle payment to ${settings.zelleContact} for $${amount}`;
  return settings.applePayNote;
}

function usePosTickets(): PosState {
  const [tickets, setTickets] = useState<PosTicketRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return watchPosTickets(
      (data) => {
        setTickets(data);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
  }, []);

  return { tickets, loading, error };
}

export function AdminPage({ path }: AdminPageProps) {
  // The live menu from Firestore (menuItems collection).
  const products = useMenuProducts();
  const [payments, setPayments] = useState<PaymentSettings>(initialPaymentSettings);
  // Global operating mode, shared by every admin device via settings/app.
  const [testMode, setTestMode] = useState(false);
  const rawPos = usePosTickets();
  const title = adminTitle(path);
  const isPosMode = title === "Live POS" || title === "Orders";

  // First admin visit with an empty menu collection: copy the starter menu in
  // so edits from then on persist to Firestore instead of reverting.
  useEffect(() => {
    seedMenuItemsIfEmpty(menuProducts).catch(() => undefined);
  }, []);

  // Same one-time seed for the availability windows and pickup locations
  // collections, which were fixture-only before this feature.
  useEffect(() => {
    seedAvailabilityWindowsIfEmpty(starterAvailabilityWindows).catch(() => undefined);
    seedPickupLocationsIfEmpty(starterPickupLocations).catch(() => undefined);
  }, []);

  // Payment accounts live in settings/payments; fixture values are only the
  // fallback until the stored doc loads (or before the first save).
  useEffect(
    () =>
      watchPaymentSettings(
        (stored) => setPayments({ ...initialPaymentSettings, ...stored }),
        () => undefined
      ),
    []
  );

  useEffect(
    () =>
      watchAppState(
        (state) => setTestMode(state.testMode),
        () => undefined
      ),
    []
  );

  // Every admin view sees only the current mode's tickets: real sales normally,
  // practice sales while test mode is on.
  const pos: PosState = {
    ...rawPos,
    tickets: rawPos.tickets.filter((ticket) => ticket.isTest === testMode)
  };

  const [clearingTests, setClearingTests] = useState(false);
  const [clearTestsError, setClearTestsError] = useState("");

  async function handleClearTestData() {
    const count = pos.tickets.length;
    const confirmed = window.confirm(
      `Permanently delete ${count} test sale${count === 1 ? "" : "s"}? Real sales are not affected. This cannot be undone.`
    );
    if (!confirmed) return;
    setClearTestsError("");
    setClearingTests(true);
    try {
      await deleteAllTestTickets();
    } catch (error) {
      setClearTestsError(
        error instanceof Error ? error.message : "Could not clear the test data."
      );
    } finally {
      setClearingTests(false);
    }
  }

  return (
    <main className="admin-shell">
      <section className="admin-heading">
        <p className="eyebrow">{isPosMode ? "Live POS Mode" : "Owner Area"}</p>
        <h1>{title}</h1>
      </section>

      {testMode && (
        <div className="test-mode-banner" role="status">
          <FlaskConical size={20} />
          <span>
            Test mode is on for everyone — sales are practice only and stay out of real
            reports. Switch back in Settings.
            {clearTestsError && ` Could not clear: ${clearTestsError}`}
          </span>
          <button
            className="button button-small"
            type="button"
            onClick={handleClearTestData}
            disabled={clearingTests || pos.tickets.length === 0}
          >
            <Trash2 size={16} />
            {clearingTests
              ? "Clearing…"
              : `Clear test data${pos.tickets.length > 0 ? ` (${pos.tickets.length})` : ""}`}
          </button>
        </div>
      )}

      {title === "Dashboard" && <Dashboard pos={pos} products={products} />}
      {title === "Live POS" && <PosView products={products} payments={payments} testMode={testMode} />}
      {title === "Pre-Orders" && <PreordersTopLevelView />}
      {title === "Orders" && <OrdersView pos={pos} products={products} />}
      {title === "Menu" && <MenuView products={products} />}
      {title === "Availability" && <AvailabilityView />}
      {title === "Vendor" && <VendorAdminView />}
      {title === "Contacts" && <ContactsView />}
      {title === "Settings" && (
        <SettingsView payments={payments} products={products} testMode={testMode} />
      )}
      {title === "Reports" && <ReportsView pos={pos} />}
    </main>
  );
}

function Dashboard({ pos, products }: { pos: PosState; products: MenuProduct[] }) {
  const todayKey = businessTodayKey();
  const paidToday = pos.tickets.filter(
    (ticket) => ticket.status === "paid" && businessDateKey(ticket.createdAtUtc) === todayKey
  );
  const revenueToday = paidToday.reduce((sum, ticket) => sum + ticket.totalCents, 0);
  const itemsToday = paidToday.reduce(
    (sum, ticket) => sum + ticket.items.reduce((count, item) => count + item.quantity, 0),
    0
  );
  const productTotals = paidToday.flatMap((ticket) => ticket.items).reduce<Record<string, number>>(
    (acc, item) => {
      acc[item.productName] = (acc[item.productName] ?? 0) + item.quantity;
      return acc;
    },
    {}
  );

  return (
    <>
      <div className="metric-grid">
        <Metric icon={Download} label="Sales today" value={formatMoney(revenueToday)} />
        <Metric icon={ClipboardCheck} label="Tickets today" value={paidToday.length} />
        <Metric icon={Package} label="Items today" value={itemsToday} />
        <Metric icon={CreditCard} label="Active menu" value={products.filter((p) => p.status === "active").length} />
      </div>

      {pos.error && <p className="muted">Live sales unavailable: {pos.error}</p>}

      <section className="admin-grid">
        <article className="admin-card">
          <h2>Today by item</h2>
          {pos.loading ? (
            <p className="muted">Loading sales…</p>
          ) : Object.keys(productTotals).length === 0 ? (
            <p className="muted">No sales yet today. Ring one up in Live POS.</p>
          ) : (
            Object.entries(productTotals).map(([name, count]) => (
              <div className="admin-row" key={name}>
                <span>{name}</span>
                <strong>{count} sold</strong>
              </div>
            ))
          )}
        </article>
        <article className="admin-card">
          <h2>Recent sales</h2>
          {pos.tickets.length === 0 ? (
            <p className="muted">Sales will appear here as you take them.</p>
          ) : (
            pos.tickets.slice(0, 6).map((ticket) => (
              <div className="admin-row" key={ticket.id}>
                <span>{formatBusinessDateTime(ticket.createdAtUtc)}</span>
                <strong>{formatMoney(ticket.totalCents)}</strong>
              </div>
            ))
          )}
        </article>
      </section>
    </>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string | number }) {
  return (
    <article className="metric-card">
      <Icon size={22} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function PosView({
  products,
  payments,
  testMode
}: {
  products: MenuProduct[];
  payments: PaymentSettings;
  testMode: boolean;
}) {
  const [items, setItems] = useState<PosTicketItem[]>([]);
  // Wizard stage inside the ticket panel: review the cart, then take payment.
  const [stage, setStage] = useState<"cart" | "pay">("cart");
  const [ticketOpen, setTicketOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [customerName, setCustomerName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PaidTicketSnapshot | null>(null);
  const [priceEditId, setPriceEditId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  const activeProducts = products.filter(
    (product) => product.status === "active" && product.singlePriceCents > 0
  );
  const business = useBusinessSettings();
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const taxCents = Math.round((subtotalCents * business.taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

  function addProduct(product: MenuProduct) {
    if (product.singlePriceCents <= 0) return;
    setItems((current) => {
      const existing = current.find((item) => item.productId === product.id);
      if (existing) {
        return current.map((item) =>
          item.productId === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [
        ...current,
        {
          productId: product.id,
          productName: product.name,
          quantity: 1,
          unitPriceCents: product.singlePriceCents
        }
      ];
    });
  }

  function updateItem(productId: string, quantity: number) {
    setItems((current) =>
      quantity <= 0
        ? current.filter((item) => item.productId !== productId)
        : current.map((item) => (item.productId === productId ? { ...item, quantity } : item))
    );
  }

  function clearTicket() {
    setItems([]);
    setStage("cart");
    setTicketOpen(false);
    setMethod("cash");
    setCustomerName("");
    setSaveError(null);
    setPriceEditId(null);
  }

  // Per-line price override for comps and free replacements: the item still
  // rings through (and pulls from inventory) at whatever price is set, $0 included.
  function applyPriceOverride(productId: string) {
    const cents = Math.round(Number(priceDraft) * 100);
    if (!Number.isFinite(cents) || cents < 0) return;
    setItems((current) =>
      current.map((item) =>
        item.productId === productId ? { ...item, unitPriceCents: cents } : item
      )
    );
    setPriceEditId(null);
  }

  async function handleMarkPaid() {
    if (items.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await savePosTicket({
        items,
        subtotalCents,
        taxCents,
        totalCents,
        paymentMethod: method,
        customerName: customerName.trim(),
        isTest: testMode
      });
      setReceipt({
        ticketId: saved.id,
        ticketNumber: saved.ticketNumber,
        items,
        subtotalCents,
        taxCents,
        totalCents,
        method,
        customerName: customerName.trim(),
        isTest: testMode
      });
      clearTicket();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save the sale.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pos-shell">
      <div className="pos-products" aria-label="POS menu">
        {activeProducts.map((product) => {
          const inTicket = items.find((item) => item.productId === product.id)?.quantity ?? 0;
          return (
            <button
              className="pos-product-button"
              key={product.id}
              type="button"
              onClick={() => addProduct(product)}
            >
              {inTicket > 0 && <span className="pos-tile-count">{inTicket}</span>}
              <span>{product.name}</span>
              <strong>{formatMoney(product.singlePriceCents)}</strong>
            </button>
          );
        })}
        {activeProducts.length === 0 && (
          <p className="muted">No items have a single-tamale price yet. Set one in Menu.</p>
        )}
      </div>

      {ticketOpen && (
        <button
          className="pos-backdrop"
          type="button"
          aria-label="Close ticket"
          onClick={() => setTicketOpen(false)}
        />
      )}

      <aside className={`pos-ticket${ticketOpen ? " pos-ticket-open" : ""}`} aria-label="Current ticket">
        {stage === "cart" ? (
          <>
            <div className="pos-sheet-head">
              <div>
                <p className="eyebrow">{testMode ? "Test Ticket" : "Live Ticket"}</p>
                <h2>{formatMoney(totalCents)}</h2>
              </div>
              <div className="button-row">
                <button
                  className="button button-small"
                  type="button"
                  onClick={clearTicket}
                  disabled={items.length === 0}
                >
                  Clear
                </button>
                <button
                  className="button button-small pos-ticket-close"
                  type="button"
                  aria-label="Close ticket"
                  onClick={() => setTicketOpen(false)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="pos-sheet-body">
              {items.length === 0 ? (
                <p className="muted">Tap menu items to build the ticket.</p>
              ) : (
                items.map((item) => (
                  <div className="pos-ticket-line" key={item.productId}>
                    <div className="pos-line-info">
                      <strong>{item.productName}</strong>
                      {priceEditId === item.productId ? (
                        <span className="pos-price-edit">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            inputMode="decimal"
                            value={priceDraft}
                            aria-label={`New unit price for ${item.productName}`}
                            onChange={(event) => setPriceDraft(event.target.value)}
                          />
                          <button
                            className="button button-small"
                            type="button"
                            onClick={() => applyPriceOverride(item.productId)}
                          >
                            Set
                          </button>
                        </span>
                      ) : (
                        <button
                          className="pos-price-button"
                          type="button"
                          title="Tap to override the price (comp / replacement)"
                          onClick={() => {
                            setPriceEditId(item.productId);
                            setPriceDraft((item.unitPriceCents / 100).toFixed(2));
                          }}
                        >
                          {item.unitPriceCents === 0
                            ? "FREE — comp"
                            : `${formatMoney(item.unitPriceCents)} each`}
                        </button>
                      )}
                    </div>
                    <div className="pos-qty">
                      <button
                        type="button"
                        onClick={() => updateItem(item.productId, item.quantity - 1)}
                      >
                        -
                      </button>
                      <output>{item.quantity}</output>
                      <button
                        type="button"
                        onClick={() => updateItem(item.productId, item.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    <strong className="pos-line-total">
                      {formatMoney(item.quantity * item.unitPriceCents)}
                    </strong>
                  </div>
                ))
              )}
            </div>

            <div className="pos-sheet-foot">
              <p className="pos-foot-summary">
                <span className="muted">
                  Subtotal {formatMoney(subtotalCents)} · Tax {formatMoney(taxCents)}
                </span>
                <strong>{formatMoney(totalCents)}</strong>
              </p>
              <button
                className="button button-primary"
                type="button"
                disabled={items.length === 0}
                onClick={() => setStage("pay")}
              >
                Charge {formatMoney(totalCents)}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pos-sheet-head">
              <button className="button button-small" type="button" onClick={() => setStage("cart")}>
                <ArrowLeft size={16} />
                Ticket
              </button>
              <div className="pos-pay-amount">
                <p className="eyebrow">{testMode ? "Test Charge" : "Charge"}</p>
                <h2>{formatMoney(totalCents)}</h2>
              </div>
              <button
                className="button button-small pos-ticket-close"
                type="button"
                aria-label="Close ticket"
                onClick={() => setTicketOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="pos-sheet-body">
              <label className="pos-name-field">
                Name for the order (optional)
                <input
                  type="text"
                  value={customerName}
                  autoComplete="off"
                  placeholder="e.g. Maria"
                  onChange={(event) => setCustomerName(event.target.value)}
                />
              </label>
              <fieldset className="pos-pay-methods">
                <legend>Payment</legend>
                {(Object.keys(paymentLabels) as PaymentMethod[]).map((key) => (
                  <label
                    className={key === "applepay" && !payments.applePayEnabled ? "choice-disabled" : ""}
                    key={key}
                  >
                    <input
                      type="radio"
                      name="pos-payment"
                      value={key}
                      checked={method === key}
                      disabled={key === "applepay" && !payments.applePayEnabled}
                      onChange={() => setMethod(key)}
                    />
                    <span>{paymentLabels[key]}</span>
                  </label>
                ))}
              </fieldset>
              {method === "cash" ? (
                <p className="muted">Collect cash from the customer, then tap Mark Paid.</p>
              ) : (
                <div className="pos-pay-qr">
                  <QRCodePanel
                    url={methodUrl(method, payments, totalCents)}
                    title={`Pay with ${paymentLabels[method]}`}
                    eventName={formatMoney(totalCents)}
                    alt={`QR code for ${paymentLabels[method]} payment`}
                  />
                </div>
              )}
              {saveError && (
                <p className="form-notice form-notice-error" role="alert">
                  Could not save: {saveError}
                </p>
              )}
            </div>

            <div className="pos-sheet-foot">
              <button
                className="button button-primary"
                type="button"
                onClick={handleMarkPaid}
                disabled={saving}
              >
                {saving ? "Saving…" : `Mark Paid — ${formatMoney(totalCents)}`}
              </button>
            </div>
          </>
        )}
      </aside>

      <div className="pos-bar">
        <button
          className="pos-bar-summary"
          type="button"
          onClick={() => {
            setStage("cart");
            setTicketOpen(true);
          }}
          disabled={items.length === 0}
        >
          <span>
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
          <strong>{formatMoney(totalCents)}</strong>
        </button>
        <button
          className="button button-primary"
          type="button"
          disabled={items.length === 0}
          onClick={() => {
            setStage("pay");
            setTicketOpen(true);
          }}
        >
          Charge {formatMoney(totalCents)}
        </button>
      </div>

      {receipt && (
        <ReceiptDrawer
          ticket={receipt}
          businessName={business.name}
          onClose={() => setReceipt(null)}
        />
      )}
    </section>
  );
}

interface PaidTicketSnapshot {
  ticketId: string;
  ticketNumber: string;
  items: PosTicketItem[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  method: PaymentMethod;
  customerName: string;
  isTest: boolean;
}

function ReceiptDrawer({
  ticket,
  businessName,
  onClose
}: {
  ticket: PaidTicketSnapshot;
  businessName: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [savedWithoutEmail, setSavedWithoutEmail] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const marketingOptIn = form.get("optIn") === "on";
    if (!email) return;
    setBusy(true);
    setError("");
    try {
      await addReceiptContact({
        email,
        marketingOptIn,
        ticketId: ticket.ticketId,
        ticketNumber: ticket.ticketNumber,
        totalCents: ticket.totalCents,
        isTest: ticket.isTest
      });
      if (receiptEmailConfigured()) {
        await sendReceiptEmail({
          toEmail: email,
          businessName,
          ticketNumber: ticket.ticketNumber,
          purchasedAt: formatBusinessDateTime(new Date().toISOString()),
          items: ticket.items.map((item) => ({
            name: item.productName,
            quantity: item.quantity,
            unitPrice: formatMoney(item.unitPriceCents),
            lineTotal: formatMoney(item.quantity * item.unitPriceCents)
          })),
          subtotal: formatMoney(ticket.subtotalCents),
          tax: formatMoney(ticket.taxCents),
          total: formatMoney(ticket.totalCents),
          paymentMethod: paymentLabels[ticket.method],
          customerName: ticket.customerName || undefined,
          signupUrl: marketingOptIn
            ? undefined
            : `${window.location.origin}/updates?email=${encodeURIComponent(email)}`
        });
      } else {
        setSavedWithoutEmail(true);
      }
      setSentTo(email);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the receipt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="pos-backdrop receipt-backdrop"
        type="button"
        aria-label="Close receipt"
        onClick={onClose}
      />
      <div className="receipt-drawer" role="dialog" aria-label="Email receipt">
        {sentTo ? (
          <>
            <ClipboardCheck size={28} />
            <h2>{savedWithoutEmail ? "Email saved" : "Receipt sent!"}</h2>
            <p className="muted">
              {savedWithoutEmail
                ? `${sentTo} was added to the contact list. Email sending isn't configured yet, so no receipt email went out.`
                : `Receipt emailed to ${sentTo}.`}
            </p>
            <button className="button button-primary" type="button" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <h2>Receipt?</h2>
            <p className="muted">
              {formatMoney(ticket.totalCents)} · {ticket.ticketNumber}. Hand the device to the
              customer to email their receipt.
            </p>
            <form className="settings-list" onSubmit={handleSubmit}>
              <label>
                Email address
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  placeholder="you@example.com"
                  autoFocus
                  required
                />
              </label>
              <label className="toggle-row">
                <input name="optIn" type="checkbox" />
                <span>Send me updates about the next pop-up and events</span>
              </label>
              {error && (
                <p className="form-notice form-notice-error" role="alert">
                  {error}
                </p>
              )}
              <div className="button-row">
                <button className="button button-primary" type="submit" disabled={busy}>
                  <Mail size={18} />
                  {busy ? "Sending…" : "Email My Receipt"}
                </button>
                <button className="button button-ghost" type="button" onClick={onClose}>
                  No Thanks
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </>
  );
}

function useOrders() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      watchOrders(
        (data) => {
          setOrders(data);
          setLoading(false);
          setError(null);
        },
        (err) => {
          setError(err.message);
          setLoading(false);
        }
      ),
    []
  );
  return { orders, loading, error };
}

const openOrderStatuses: OrderStatus[] = ["new", "confirmed", "preparing", "ready"];

function OrdersView({ pos, products }: { pos: PosState; products: MenuProduct[] }) {
  const [group, setGroup] = useState<"overview" | "pos" | "preorders">("overview");
  const preorders = useOrders();
  const todayKey = businessTodayKey();
  const paid = pos.tickets.filter((ticket) => ticket.status === "paid");
  const paidToday = paid.filter((ticket) => businessDateKey(ticket.createdAtUtc) === todayKey);
  const revenueToday = paidToday.reduce((sum, ticket) => sum + ticket.totalCents, 0);
  const revenueAllTime = paid.reduce((sum, ticket) => sum + ticket.totalCents, 0);
  const lastSale = paid[0];
  const newRequests = preorders.orders.filter((order) => order.status === "new");
  const openOrders = preorders.orders.filter((order) => openOrderStatuses.includes(order.status));

  if (group === "pos") {
    return <PosOrdersDetail pos={pos} products={products} onBack={() => setGroup("overview")} />;
  }

  if (group === "preorders") {
    return <PreordersDetail preorders={preorders} onBack={() => setGroup("overview")} />;
  }

  return (
    <section className="order-groups">
      <button className="admin-card order-group-card" type="button" onClick={() => setGroup("pos")}>
        <div className="order-group-head">
          <CreditCard size={24} />
          <h2>Mobile POS Sales</h2>
          <span className="status-badge product-status-active">Live</span>
        </div>
        {pos.loading ? (
          <p className="muted">Loading sales…</p>
        ) : pos.error ? (
          <p className="muted">Sales unavailable: {pos.error}</p>
        ) : (
          <div className="order-group-stats">
            <div>
              <span>Sales today</span>
              <strong>{paidToday.length}</strong>
            </div>
            <div>
              <span>Revenue today</span>
              <strong>{formatMoney(revenueToday)}</strong>
            </div>
            <div>
              <span>All time</span>
              <strong>
                {paid.length} · {formatMoney(revenueAllTime)}
              </strong>
            </div>
            <div>
              <span>Last sale</span>
              <strong>{lastSale ? formatBusinessDateTime(lastSale.createdAtUtc) : "—"}</strong>
            </div>
          </div>
        )}
        <span className="order-group-cta">
          View all POS sales
          <ChevronRight size={18} />
        </span>
      </button>

      <button className="admin-card order-group-card" type="button" onClick={() => setGroup("preorders")}>
        <div className="order-group-head">
          <CalendarDays size={24} />
          <h2>Batch Pre-orders</h2>
          <span className="status-badge product-status-active">Live</span>
        </div>
        {preorders.loading ? (
          <p className="muted">Loading pre-orders…</p>
        ) : preorders.error ? (
          <p className="muted">Pre-orders unavailable: {preorders.error}</p>
        ) : (
          <div className="order-group-stats">
            <div>
              <span>New requests</span>
              <strong>{newRequests.length}</strong>
            </div>
            <div>
              <span>Open orders</span>
              <strong>{openOrders.length}</strong>
            </div>
            <div>
              <span>All time</span>
              <strong>{preorders.orders.length}</strong>
            </div>
            <div>
              <span>Latest request</span>
              <strong>
                {preorders.orders[0]
                  ? formatBusinessDateTime(preorders.orders[0].createdAtUtc)
                  : "—"}
              </strong>
            </div>
          </div>
        )}
        <span className="order-group-cta">
          Manage pre-orders
          <ChevronRight size={18} />
        </span>
      </button>
    </section>
  );
}

function PreordersTopLevelView() {
  const preorders = useOrders();
  return <PreordersDetail preorders={preorders} onBack={() => navigate("/admin/orders")} />;
}

function PreordersDetail({
  preorders,
  onBack
}: {
  preorders: { orders: OrderRecord[]; loading: boolean; error: string | null };
  onBack: () => void;
}) {
  const [actionError, setActionError] = useState("");
  const [rejectingOrder, setRejectingOrder] = useState<OrderRecord | null>(null);
  const availabilityWindows = useAvailabilityWindows();
  const openCount = preorders.orders.filter((order) =>
    openOrderStatuses.includes(order.status)
  ).length;

  async function transition(order: OrderRecord, status: OrderStatus) {
    if (status === "canceled") {
      setRejectingOrder(order);
      return;
    }
    setActionError("");
    try {
      await updateOrderStatus(order.id, status);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The status change could not be saved."
      );
    }
  }

  async function confirmReject(order: OrderRecord) {
    setActionError("");
    try {
      await updateOrderStatus(order.id, "canceled");
      setRejectingOrder(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The status change could not be saved."
      );
    }
  }

  return (
    <>
    <section className="admin-card">
      <div className="toolbar">
        <button className="button button-small" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          All orders
        </button>
      </div>
      <h2>Batch Pre-orders</h2>
      {preorders.loading ? (
        <p className="muted">Loading pre-orders…</p>
      ) : preorders.error ? (
        <p className="muted">Pre-orders unavailable: {preorders.error}</p>
      ) : preorders.orders.length === 0 ? (
        <p className="muted">
          No pre-orders yet. Requests from the website order page will land here.
        </p>
      ) : (
        <>
          <div className="admin-row">
            <span>
              {preorders.orders.length} request{preorders.orders.length === 1 ? "" : "s"}
            </span>
            <strong>{openCount} open</strong>
          </div>
          {actionError && (
            <p className="form-notice form-notice-error" role="alert">
              {actionError}
            </p>
          )}
          {preorders.orders.map((order) => {
            const window = availabilityWindows.find(
              (item) => item.id === order.availabilityWindowId
            );
            return (
              <article className="receipt-card" key={order.id}>
                <div className="receipt-head">
                  <div>
                    <strong>
                      {order.customer.name} · {order.orderNumber}
                    </strong>
                    <span className="muted">{formatBusinessDateTime(order.createdAtUtc)}</span>
                  </div>
                  <span className={`status-badge status-${order.status}`}>
                    {statusLabels[order.status]}
                  </span>
                </div>
                <p className="preorder-contact">
                  <a href={`tel:${order.customer.mobile}`}>{order.customer.mobile}</a>
                  {" · "}
                  <a href={`mailto:${order.customer.email}`}>{order.customer.email}</a>
                  {" · "}prefers {order.customer.preferredContact}
                </p>
                {window && (
                  <p className="muted preorder-window">
                    {window.label} — {formatWindow(window)}
                  </p>
                )}
                <div className="receipt-lines">
                  {order.items.map((line) => (
                    <div className="receipt-line" key={`${order.id}-${line.variantId}`}>
                      <span>
                        {line.quantity} × {line.productName} · {line.variantLabel}
                      </span>
                      <span className="muted">@ {formatMoney(line.unitPriceCents)}</span>
                      <strong>{formatMoney(line.lineTotalCents)}</strong>
                    </div>
                  ))}
                </div>
                {order.bulk.enabled && (
                  <p className="muted">
                    Bulk order — {order.bulk.guestCount || "?"} guests
                    {order.bulk.occasion ? ` · ${order.bulk.occasion}` : ""}
                    {order.bulk.desiredReadyTime ? ` · ready by ${order.bulk.desiredReadyTime}` : ""}
                  </p>
                )}
                {order.customer.notes && <p className="muted">Note: {order.customer.notes}</p>}
                <div className="receipt-totals">
                  <div className="receipt-grand">
                    <span>Estimated total</span>
                    <strong>{formatMoney(order.totals.totalCents)}</strong>
                  </div>
                </div>
                <div className="button-row">
                  {(["confirmed", "preparing", "ready", "completed", "canceled"] as OrderStatus[])
                    .filter((status) => canTransitionOrder(order.status, status))
                    .map((status) => (
                      <button
                        key={status}
                        className="button button-small"
                        type="button"
                        onClick={() => void transition(order, status)}
                      >
                        {status === "canceled" ? "Reject" : statusLabels[status]}
                      </button>
                    ))}
                </div>
              </article>
            );
          })}
        </>
      )}
    </section>
    {rejectingOrder && (
      <div className="modal-overlay">
        <div className="admin-card modal-card" role="dialog" aria-label="Confirm rejection">
          <h2>Reject {rejectingOrder.orderNumber}?</h2>
          <p className="muted">
            Reach out to {rejectingOrder.customer.name} before rejecting — they prefer{" "}
            {rejectingOrder.customer.preferredContact}.
          </p>
          <div className="button-row">
            <a className="button button-small" href={`tel:${rejectingOrder.customer.mobile}`}>
              Call {rejectingOrder.customer.mobile}
            </a>
            <a className="button button-small" href={`mailto:${rejectingOrder.customer.email}`}>
              Email {rejectingOrder.customer.email}
            </a>
          </div>
          {actionError && (
            <p className="form-notice form-notice-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="button-row">
            <button
              className="button button-primary"
              type="button"
              onClick={() => void confirmReject(rejectingOrder)}
            >
              Confirm Rejection
            </button>
            <button
              className="button button-ghost"
              type="button"
              onClick={() => setRejectingOrder(null)}
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}

function PosOrdersDetail({
  pos,
  products,
  onBack
}: {
  pos: PosState;
  products: MenuProduct[];
  onBack: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const tickets = pos.tickets;
  const paid = tickets.filter((ticket) => ticket.status === "paid");
  const voidedCount = tickets.length - paid.length;
  const revenueAllTime = paid.reduce((sum, ticket) => sum + ticket.totalCents, 0);

  async function run(action: () => Promise<void>) {
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The change could not be saved.");
    }
  }

  function handleDelete(ticket: PosTicketRecord) {
    const confirmed = window.confirm(
      `Permanently delete ${ticket.ticketNumber} (${formatMoney(ticket.totalCents)})? ` +
        "This removes it from all reports and cannot be undone. Voiding keeps a record instead."
    );
    if (!confirmed) return;
    if (editingId === ticket.id) setEditingId(null);
    void run(() => deletePosTicket(ticket));
  }

  return (
    <section className="admin-card">
      <div className="toolbar">
        <button className="button button-small" type="button" onClick={onBack}>
          <ArrowLeft size={16} />
          All orders
        </button>
      </div>
      <h2>Mobile POS Sales</h2>
      {pos.loading ? (
        <p className="muted">Loading sales…</p>
      ) : pos.error ? (
        <p className="muted">Sales unavailable: {pos.error}</p>
      ) : tickets.length === 0 ? (
        <p className="muted">No POS sales yet. Ring one up in Live POS.</p>
      ) : (
        <>
          <div className="admin-row">
            <span>
              {paid.length} sales{voidedCount > 0 ? ` · ${voidedCount} voided` : ""}
            </span>
            <strong>{formatMoney(revenueAllTime)}</strong>
          </div>
          {actionError && (
            <p className="form-notice form-notice-error" role="alert">
              {actionError}
            </p>
          )}
          {tickets.map((ticket) =>
            editingId === ticket.id ? (
              <TicketEditor
                key={ticket.id}
                ticket={ticket}
                products={products}
                onClose={() => setEditingId(null)}
              />
            ) : (
              <article
                className={`receipt-card${ticket.status === "void" ? " receipt-void" : ""}`}
                key={ticket.id}
              >
                <div className="receipt-head">
                  <div>
                    <strong>
                      {ticket.customerName ? `${ticket.customerName} · ` : ""}
                      {ticket.ticketNumber}
                    </strong>
                    <span className="muted">{formatBusinessDateTime(ticket.createdAtUtc)}</span>
                  </div>
                  <span className="price-chip">
                    <span>{paymentLabels[ticket.paymentMethod]}</span>
                  </span>
                  {ticket.status === "void" && (
                    <span className="status-badge product-status-inactive">Void</span>
                  )}
                </div>
                <div className="receipt-lines">
                  {ticket.items.map((item) => (
                    <div className="receipt-line" key={`${ticket.id}-${item.productId}`}>
                      <span>
                        {item.quantity} × {item.productName}
                      </span>
                      <span className="muted">@ {formatMoney(item.unitPriceCents)}</span>
                      <strong>{formatMoney(item.quantity * item.unitPriceCents)}</strong>
                    </div>
                  ))}
                </div>
                <div className="receipt-totals">
                  <div>
                    <span>Subtotal</span>
                    <strong>{formatMoney(ticket.subtotalCents)}</strong>
                  </div>
                  <div>
                    <span>Tax</span>
                    <strong>{formatMoney(ticket.taxCents)}</strong>
                  </div>
                  <div className="receipt-grand">
                    <span>Total</span>
                    <strong>{formatMoney(ticket.totalCents)}</strong>
                  </div>
                </div>
                <div className="button-row">
                  {ticket.status === "paid" ? (
                    <>
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() => setEditingId(ticket.id)}
                      >
                        <Pencil size={16} />
                        Edit
                      </button>
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() => void run(() => setPosTicketStatus(ticket, "void"))}
                      >
                        <Ban size={16} />
                        Void
                      </button>
                    </>
                  ) : (
                    <button
                      className="button button-small"
                      type="button"
                      onClick={() => void run(() => setPosTicketStatus(ticket, "paid"))}
                    >
                      <RotateCcw size={16} />
                      Restore
                    </button>
                  )}
                  <button
                    className="button button-small"
                    type="button"
                    onClick={() => handleDelete(ticket)}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              </article>
            )
          )}
        </>
      )}
    </section>
  );
}

function TicketEditor({
  ticket,
  products,
  onClose
}: {
  ticket: PosTicketRecord;
  products: MenuProduct[];
  onClose: () => void;
}) {
  const business = useBusinessSettings();
  const [items, setItems] = useState<PosTicketItem[]>(() =>
    ticket.items.map((item) => ({ ...item }))
  );
  const [method, setMethod] = useState<PaymentMethod>(ticket.paymentMethod);
  const [customerName, setCustomerName] = useState(ticket.customerName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const taxCents = Math.round((subtotalCents * business.taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;
  const addable = products.filter(
    (product) =>
      product.status === "active" &&
      product.singlePriceCents > 0 &&
      !items.some((item) => item.productId === product.id)
  );

  function updateQuantity(productId: string, quantity: number) {
    setItems((current) =>
      quantity <= 0
        ? current.filter((item) => item.productId !== productId)
        : current.map((item) => (item.productId === productId ? { ...item, quantity } : item))
    );
  }

  function addItem(productId: string) {
    const product = products.find((item) => item.id === productId);
    if (!product) return;
    setItems((current) => [
      ...current,
      {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPriceCents: product.singlePriceCents
      }
    ]);
  }

  async function handleSave() {
    if (items.length === 0) {
      setError("A ticket needs at least one item — use Void or Delete to remove the whole sale.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updatePosTicket(ticket, {
        items,
        subtotalCents,
        taxCents,
        totalCents,
        paymentMethod: method,
        customerName: customerName.trim()
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the changes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="receipt-card">
      <div className="receipt-head">
        <div>
          <strong>Editing {ticket.ticketNumber}</strong>
          <span className="muted">{formatBusinessDateTime(ticket.createdAtUtc)}</span>
        </div>
      </div>
      <div className="receipt-lines">
        {items.map((item) => (
          <div className="ticket-edit-line" key={item.productId}>
            <div>
              <strong>{item.productName}</strong>
              <span className="muted"> @ {formatMoney(item.unitPriceCents)}</span>
            </div>
            <div className="pos-qty">
              <button type="button" onClick={() => updateQuantity(item.productId, item.quantity - 1)}>
                -
              </button>
              <output>{item.quantity}</output>
              <button type="button" onClick={() => updateQuantity(item.productId, item.quantity + 1)}>
                +
              </button>
            </div>
            <strong>{formatMoney(item.quantity * item.unitPriceCents)}</strong>
          </div>
        ))}
      </div>
      {addable.length > 0 && (
        <label className="ticket-edit-add">
          Add item
          <select
            value=""
            onChange={(event) => {
              if (event.target.value) addItem(event.target.value);
            }}
          >
            <option value="">Choose an item…</option>
            {addable.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({formatMoney(product.singlePriceCents)})
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="ticket-edit-add">
        Payment method
        <select
          value={method}
          onChange={(event) => setMethod(event.target.value as PaymentMethod)}
        >
          {(Object.keys(paymentLabels) as PaymentMethod[]).map((key) => (
            <option key={key} value={key}>
              {paymentLabels[key]}
            </option>
          ))}
        </select>
      </label>
      <label className="ticket-edit-add">
        Name for the order
        <input
          type="text"
          value={customerName}
          autoComplete="off"
          placeholder="e.g. Maria"
          onChange={(event) => setCustomerName(event.target.value)}
        />
      </label>
      <div className="receipt-totals">
        <div>
          <span>Subtotal</span>
          <strong>{formatMoney(subtotalCents)}</strong>
        </div>
        <div>
          <span>Tax (recalculated at {business.taxRateBps / 100}%)</span>
          <strong>{formatMoney(taxCents)}</strong>
        </div>
        <div className="receipt-grand">
          <span>Total</span>
          <strong>{formatMoney(totalCents)}</strong>
        </div>
      </div>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button className="button button-primary" type="button" onClick={handleSave} disabled={busy}>
          {busy ? "Saving…" : "Save Changes"}
        </button>
        <button className="button button-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </article>
  );
}

const spiceLevels: SpiceLevel[] = ["mild", "medium", "hot"];
const productStatuses: Record<ProductStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  sold_out: "Sold out"
};

const DEFAULT_PRODUCT_IMAGE = "/media/tamales_hero.webp";

const batchVariantSpecs = [
  { unitQuantity: 6, label: "Half dozen", field: "halfDozenPrice", idSuffix: "half-dozen" },
  { unitQuantity: 12, label: "Dozen", field: "dozenPrice", idSuffix: "dozen" }
] as const;

function parsePriceCents(value: FormDataEntryValue | null): number {
  const cents = Math.round(Number(value || "0") * 100);
  return Number.isFinite(cents) && cents > 0 ? cents : 0;
}

function centsToInput(cents: number | undefined): string {
  return cents && cents > 0 ? (cents / 100).toFixed(2) : "";
}

// datetime-local inputs read/write the browser's local time with no
// timezone offset in the string, so these convert to/from the UTC ISO
// strings AvailabilityWindow stores.
function toDatetimeLocalValue(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const localMs = date.getTime() - date.getTimezoneOffset() * 60000;
  return new Date(localMs).toISOString().slice(0, 16);
}

function toIsoFromLocal(value: FormDataEntryValue | null): string {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function MenuView({ products }: { products: MenuProduct[] }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuError, setMenuError] = useState("");

  // All menu mutations write straight to Firestore; the live snapshot updates
  // this page (and the POS + customer site) when the write lands.
  async function persist(action: () => Promise<void>) {
    setMenuError("");
    try {
      await action();
    } catch (error) {
      setMenuError(error instanceof Error ? error.message : "Could not save the menu change.");
    }
  }

  function addProduct(product: MenuProduct) {
    const maxSort = products.reduce((max, item) => Math.max(max, item.sortOrder), 0);
    void persist(() => saveMenuItem({ ...product, sortOrder: maxSort + 1 }));
    setAdding(false);
  }

  function saveProduct(updated: MenuProduct) {
    void persist(() => saveMenuItem(updated));
    setEditingId(null);
  }

  function removeProduct(product: MenuProduct) {
    if (!window.confirm(`Remove ${product.name} from the menu? This is permanent.`)) return;
    void persist(() => deleteMenuItem(product.id));
  }

  function toggleBulk(product: MenuProduct) {
    void persist(() =>
      saveMenuItem({ ...product, bulkMenuEnabled: !product.bulkMenuEnabled })
    );
  }

  return (
    <section className="menu-manager">
      <div className="menu-toolbar">
        <p className="muted">
          {products.length} menu item{products.length === 1 ? "" : "s"}
        </p>
        <button
          className={`button ${adding ? "button-ghost" : "button-primary"}`}
          type="button"
          onClick={() => {
            setAdding((current) => !current);
            setEditingId(null);
          }}
        >
          <Plus size={18} />
          {adding ? "Close" : "Add Menu Item"}
        </button>
      </div>

      {menuError && (
        <p className="form-notice form-notice-error" role="alert">
          {menuError}
        </p>
      )}

      {adding && <ProductForm onSave={addProduct} onCancel={() => setAdding(false)} />}

      <div className="menu-grid">
        {products.map((product) =>
          editingId === product.id ? (
            <ProductForm
              key={product.id}
              product={product}
              onSave={saveProduct}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <MenuItemCard
              key={product.id}
              product={product}
              onEdit={() => {
                setEditingId(product.id);
                setAdding(false);
              }}
              onRemove={() => removeProduct(product)}
              onToggleBulk={() => toggleBulk(product)}
            />
          )
        )}
      </div>
    </section>
  );
}

function MenuItemCard({
  product,
  onEdit,
  onRemove,
  onToggleBulk
}: {
  product: MenuProduct;
  onEdit: () => void;
  onRemove: () => void;
  onToggleBulk: () => void;
}) {
  return (
    <article className="admin-card menu-item-card">
      <div className="menu-item-photo-wrap">
        <img className="menu-item-photo" src={product.imageUrl} alt={product.name} />
        <span className={`status-badge product-status-${product.status}`}>
          {productStatuses[product.status]}
        </span>
      </div>
      <div className="menu-item-body">
        <h3>{product.name}</h3>
        {product.description && <p className="muted menu-item-description">{product.description}</p>}
        <div className="price-chips">
          {product.singlePriceCents > 0 && (
            <span className="price-chip">
              <span>Single</span>
              <strong>{formatMoney(product.singlePriceCents)}</strong>
            </span>
          )}
          {product.variants.map((variant) => (
            <span className="price-chip" key={variant.id}>
              <span>{variant.label}</span>
              <strong>{formatMoney(variant.priceCents)}</strong>
            </span>
          ))}
          {product.singlePriceCents <= 0 && product.variants.length === 0 && (
            <span className="muted">No prices set</span>
          )}
        </div>
        <label className="toggle-row">
          <input type="checkbox" checked={product.bulkMenuEnabled} onChange={onToggleBulk} />
          <span>Show on preorder menu</span>
        </label>
        <div className="button-row">
          <button className="button button-small" type="button" onClick={onEdit}>
            <Pencil size={16} />
            Edit
          </button>
          <button className="button button-small" type="button" onClick={onRemove}>
            <Trash2 size={16} />
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductForm({
  product,
  onSave,
  onCancel
}: {
  product?: MenuProduct;
  onSave: (product: MenuProduct) => void;
  onCancel: () => void;
}) {
  const [image, setImage] = useState(product?.imageUrl ?? "");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const slug = product?.slug ?? slugify(name);
    const id = product?.id ?? `custom-${slug}-${Date.now()}`;
    const variants: MenuVariant[] = batchVariantSpecs.flatMap((spec, index) => {
      const priceCents = parsePriceCents(form.get(spec.field));
      if (priceCents <= 0) return [];
      const existing = product?.variants.find((variant) => variant.unitQuantity === spec.unitQuantity);
      return [
        {
          id: existing?.id ?? `${slug}-${spec.idSuffix}`,
          productId: id,
          label: spec.label,
          unitQuantity: spec.unitQuantity,
          priceCents,
          minimumQuantity: existing?.minimumQuantity ?? 1,
          active: existing?.active ?? true,
          sortOrder: index + 1
        }
      ];
    });
    onSave({
      id,
      name,
      slug,
      description: String(form.get("description") ?? "").trim(),
      ingredients: String(form.get("ingredients") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      spiceLevel: (form.get("spiceLevel") as SpiceLevel) || "mild",
      allergyNotice: String(form.get("allergyNotice") ?? "").trim(),
      imageUrl: image || DEFAULT_PRODUCT_IMAGE,
      singlePriceCents: parsePriceCents(form.get("singlePrice")),
      status: (form.get("status") as ProductStatus) || "active",
      bulkMenuEnabled: form.get("bulkMenuEnabled") === "on",
      showWhenSoldOut: form.get("showWhenSoldOut") === "on",
      sortOrder: product?.sortOrder ?? 0,
      variants
    });
  }

  return (
    <form className="admin-card product-form" onSubmit={handleSubmit}>
      <h2>{product ? `Edit ${product.name}` : "Add Menu Item"}</h2>
      <div className="product-form-body">
        <ImagePicker value={image} onChange={setImage} />
        <div className="form-grid product-fields">
          <label className="full-span">
            Name
            <input name="name" defaultValue={product?.name ?? ""} required />
          </label>
          <div className="price-inputs full-span">
            <label>
              Single (Live POS)
              <input
                name="singlePrice"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="0.00"
                defaultValue={centsToInput(product?.singlePriceCents)}
              />
            </label>
            {batchVariantSpecs.map((spec) => (
              <label key={spec.field}>
                {spec.label}
                <input
                  name={spec.field}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0.00"
                  defaultValue={centsToInput(
                    product?.variants.find((variant) => variant.unitQuantity === spec.unitQuantity)
                      ?.priceCents
                  )}
                />
              </label>
            ))}
          </div>
          <p className="muted price-hint full-span">
            Single is what the Live POS charges per tamale. Half dozen and Dozen are the preorder
            batch prices. Leave a price blank to turn that option off.
          </p>
          <label className="full-span">
            Ingredients
            <input
              name="ingredients"
              defaultValue={product?.ingredients.join(", ") ?? ""}
              placeholder="masa, chile, pork"
            />
          </label>
          <label className="full-span">
            Short description
            <textarea name="description" rows={3} defaultValue={product?.description ?? ""} />
          </label>
          <label>
            Spice level
            <select name="spiceLevel" defaultValue={product?.spiceLevel ?? "mild"}>
              {spiceLevels.map((level) => (
                <option key={level} value={level}>
                  {level[0].toUpperCase() + level.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={product?.status ?? "active"}>
              {(Object.keys(productStatuses) as ProductStatus[]).map((status) => (
                <option key={status} value={status}>
                  {productStatuses[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="full-span">
            Allergy notice
            <textarea
              name="allergyNotice"
              rows={2}
              defaultValue={product?.allergyNotice ?? "Ask staff for allergen details."}
            />
          </label>
          <label className="toggle-row full-span">
            <input
              name="bulkMenuEnabled"
              type="checkbox"
              defaultChecked={product?.bulkMenuEnabled ?? true}
            />
            <span>Show on preorder menu</span>
          </label>
          <label className="toggle-row full-span">
            <input
              name="showWhenSoldOut"
              type="checkbox"
              defaultChecked={product?.showWhenSoldOut ?? true}
            />
            <span>Keep visible when sold out</span>
          </label>
          <div className="button-row full-span">
            <button className="button button-primary" type="submit">
              {product ? "Save Changes" : "Add Item"}
            </button>
            <button className="button button-ghost" type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}

function AvailabilityView() {
  return (
    <section className="menu-manager">
      <PickupLocationsManager />
      <AvailabilityWindowsManager />
    </section>
  );
}

function PickupLocationForm({
  location,
  onSave,
  onCancel
}: {
  location?: PickupLocation;
  onSave: (location: PickupLocation) => void;
  onCancel: () => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    onSave({
      id: location?.id ?? `location-${slugify(name)}-${Date.now()}`,
      name,
      address: String(form.get("address") ?? "").trim(),
      instructions: String(form.get("instructions") ?? "").trim(),
      active: form.get("active") === "on"
    });
  }

  return (
    <form className="admin-card" onSubmit={handleSubmit}>
      <h3>{location ? `Edit ${location.name}` : "Add Pickup Location"}</h3>
      <div className="form-grid">
        <label className="full-span">
          Name
          <input name="name" defaultValue={location?.name ?? ""} required />
        </label>
        <label className="full-span">
          Address / area
          <input name="address" defaultValue={location?.address ?? ""} />
        </label>
        <label className="full-span">
          Pickup instructions
          <textarea name="instructions" rows={2} defaultValue={location?.instructions ?? ""} />
        </label>
        <label className="toggle-row full-span">
          <input name="active" type="checkbox" defaultChecked={location?.active ?? true} />
          <span>Active</span>
        </label>
        <div className="button-row full-span">
          <button className="button button-primary" type="submit">
            {location ? "Save Changes" : "Add Location"}
          </button>
          <button className="button button-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function PickupLocationsManager() {
  const locations = usePickupLocations();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function persist(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the location.");
    }
  }

  function addLocation(location: PickupLocation) {
    void persist(() => savePickupLocation(location));
    setAdding(false);
  }

  function saveLocation(location: PickupLocation) {
    void persist(() => savePickupLocation(location));
    setEditingId(null);
  }

  function removeLocation(entry: PickupLocation) {
    if (!window.confirm(`Remove ${entry.name}? This is permanent.`)) return;
    void persist(() => deletePickupLocation(entry.id));
  }

  return (
    <section className="menu-manager">
      <div className="menu-toolbar">
        <p className="muted">
          {locations.length} pickup location{locations.length === 1 ? "" : "s"}
        </p>
        <button
          className={`button ${adding ? "button-ghost" : "button-primary"}`}
          type="button"
          onClick={() => {
            setAdding((current) => !current);
            setEditingId(null);
          }}
        >
          <Plus size={18} />
          {adding ? "Close" : "Add Location"}
        </button>
      </div>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      {adding && <PickupLocationForm onSave={addLocation} onCancel={() => setAdding(false)} />}
      <div className="menu-grid">
        {locations.map((location) =>
          editingId === location.id ? (
            <PickupLocationForm
              key={location.id}
              location={location}
              onSave={saveLocation}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <article className="admin-card" key={location.id}>
              <MapPin size={22} />
              <h3>{location.name}</h3>
              <span
                className={`status-badge product-status-${location.active ? "active" : "inactive"}`}
              >
                {location.active ? "Active" : "Inactive"}
              </span>
              {location.address && <p className="muted">{location.address}</p>}
              {location.instructions && <p className="muted">{location.instructions}</p>}
              <div className="button-row">
                <button
                  className="button button-small"
                  type="button"
                  onClick={() => {
                    setEditingId(location.id);
                    setAdding(false);
                  }}
                >
                  <Pencil size={16} />
                  Edit
                </button>
                <button
                  className="button button-small"
                  type="button"
                  onClick={() => removeLocation(location)}
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              </div>
            </article>
          )
        )}
        {locations.length === 0 && <p className="muted">No pickup locations yet.</p>}
      </div>
    </section>
  );
}

const fulfillmentTypeLabels: Record<FulfillmentType, string> = {
  scheduled_pickup: "Scheduled Pickup",
  event_pickup: "Event / Pop-up Pickup"
};

function AvailabilityWindowForm({
  windowRecord,
  locations,
  onSave,
  onCancel
}: {
  windowRecord?: AvailabilityWindow;
  locations: PickupLocation[];
  onSave: (window: AvailabilityWindow) => void;
  onCancel: () => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const label = String(form.get("label") ?? "").trim();
    if (!label) return;
    onSave({
      id: windowRecord?.id ?? `window-${slugify(label)}-${Date.now()}`,
      locationId: String(form.get("locationId") ?? ""),
      label,
      fulfillmentType: (form.get("fulfillmentType") as FulfillmentType) || "scheduled_pickup",
      startsAtUtc: toIsoFromLocal(form.get("startsAtUtc")),
      endsAtUtc: toIsoFromLocal(form.get("endsAtUtc")),
      cutoffAtUtc: toIsoFromLocal(form.get("cutoffAtUtc")),
      capacity: Math.max(0, Math.round(Number(form.get("capacity") ?? 0))),
      committedOrders: windowRecord?.committedOrders ?? 0,
      active: form.get("active") === "on",
      preordersEnabled: form.get("preordersEnabled") === "on",
      instructions: String(form.get("instructions") ?? "").trim(),
      vendorSessionId: windowRecord?.vendorSessionId
    });
  }

  return (
    <form className="admin-card" onSubmit={handleSubmit}>
      <h3>{windowRecord ? `Edit ${windowRecord.label}` : "Add Pop-Up Event"}</h3>
      <div className="form-grid">
        <label className="full-span">
          Label
          <input name="label" defaultValue={windowRecord?.label ?? ""} required />
        </label>
        <label>
          Fulfillment type
          <select
            name="fulfillmentType"
            defaultValue={windowRecord?.fulfillmentType ?? "scheduled_pickup"}
          >
            {(Object.keys(fulfillmentTypeLabels) as FulfillmentType[]).map((type) => (
              <option key={type} value={type}>
                {fulfillmentTypeLabels[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Location
          <select name="locationId" defaultValue={windowRecord?.locationId ?? ""}>
            <option value="">— Select a location —</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Starts
          <input
            name="startsAtUtc"
            type="datetime-local"
            defaultValue={toDatetimeLocalValue(windowRecord?.startsAtUtc)}
            required
          />
        </label>
        <label>
          Ends
          <input
            name="endsAtUtc"
            type="datetime-local"
            defaultValue={toDatetimeLocalValue(windowRecord?.endsAtUtc)}
            required
          />
        </label>
        <label>
          Order cutoff
          <input
            name="cutoffAtUtc"
            type="datetime-local"
            defaultValue={toDatetimeLocalValue(windowRecord?.cutoffAtUtc)}
            required
          />
        </label>
        <label>
          Capacity
          <input name="capacity" type="number" min="0" defaultValue={windowRecord?.capacity ?? 0} />
        </label>
        <label className="full-span">
          Pickup instructions
          <textarea name="instructions" rows={2} defaultValue={windowRecord?.instructions ?? ""} />
        </label>
        <label className="toggle-row full-span">
          <input name="active" type="checkbox" defaultChecked={windowRecord?.active ?? true} />
          <span>Active — visible to customers</span>
        </label>
        <label className="toggle-row full-span">
          <input
            name="preordersEnabled"
            type="checkbox"
            defaultChecked={windowRecord?.preordersEnabled ?? true}
          />
          <span>Accepting pre-orders for this event (pre-orders always close the day of)</span>
        </label>
        <div className="button-row full-span">
          <button className="button button-primary" type="submit">
            {windowRecord ? "Save Changes" : "Add Event"}
          </button>
          <button className="button button-ghost" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function AvailabilityWindowsManager() {
  const windows = useAvailabilityWindows();
  const locations = usePickupLocations();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const sortedWindows = [...windows].sort(
    (a, b) => new Date(a.startsAtUtc).getTime() - new Date(b.startsAtUtc).getTime()
  );

  async function persist(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event.");
    }
  }

  function addWindow(windowRecord: AvailabilityWindow) {
    void persist(() => saveAvailabilityWindow(windowRecord));
    setAdding(false);
  }

  function saveWindow(windowRecord: AvailabilityWindow) {
    void persist(() => saveAvailabilityWindow(windowRecord));
    setEditingId(null);
  }

  function removeWindow(entry: AvailabilityWindow) {
    if (!window.confirm(`Remove ${entry.label}? This is permanent.`)) return;
    void persist(() => deleteAvailabilityWindow(entry.id));
  }

  function togglePreorders(entry: AvailabilityWindow) {
    void persist(() => saveAvailabilityWindow({ ...entry, preordersEnabled: !entry.preordersEnabled }));
  }

  return (
    <section className="menu-manager">
      <div className="menu-toolbar">
        <p className="muted">
          {windows.length} pop-up event{windows.length === 1 ? "" : "s"}
        </p>
        <button
          className={`button ${adding ? "button-ghost" : "button-primary"}`}
          type="button"
          onClick={() => {
            setAdding((current) => !current);
            setEditingId(null);
          }}
        >
          <Plus size={18} />
          {adding ? "Close" : "Add Event"}
        </button>
      </div>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      {adding && (
        <AvailabilityWindowForm
          locations={locations}
          onSave={addWindow}
          onCancel={() => setAdding(false)}
        />
      )}
      <div className="admin-grid">
        {sortedWindows.map((entry) => {
          const location = locations.find((item) => item.id === entry.locationId);
          const bookable = isWindowSelectable(entry);
          return editingId === entry.id ? (
            <AvailabilityWindowForm
              key={entry.id}
              windowRecord={entry}
              locations={locations}
              onSave={saveWindow}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <article className="admin-card" key={entry.id}>
              <CalendarDays size={24} />
              <h2>{entry.label}</h2>
              <span className={`status-badge product-status-${bookable ? "active" : "inactive"}`}>
                {bookable ? "Accepting Pre-Orders" : "In-Person Only"}
              </span>
              <p>{formatWindow(entry)}</p>
              <p className="muted">{fulfillmentTypeLabels[entry.fulfillmentType]}</p>
              <div className="admin-row">
                <span>{location?.name ?? "No location set"}</span>
                <strong>{Math.max(0, entry.capacity - entry.committedOrders)} open</strong>
              </div>
              {entry.instructions && <p>{entry.instructions}</p>}
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={entry.preordersEnabled}
                  onChange={() => togglePreorders(entry)}
                />
                <span>Accepting pre-orders for this event</span>
              </label>
              <div className="button-row">
                <button
                  className="button button-small"
                  type="button"
                  onClick={() => {
                    setEditingId(entry.id);
                    setAdding(false);
                  }}
                >
                  <Pencil size={16} />
                  Edit
                </button>
                <button className="button button-small" type="button" onClick={() => removeWindow(entry)}>
                  <Trash2 size={16} />
                  Remove
                </button>
              </div>
            </article>
          );
        })}
        {windows.length === 0 && <p className="muted">No pop-up events yet.</p>}
      </div>
    </section>
  );
}

function VendorAdminView() {
  const session = vendorSessions[0];
  const orderUrl = `${window.location.origin}/order?vendor=${encodeURIComponent(session.publicToken)}`;
  return (
    <section className="admin-grid two-col">
      <article className="admin-card">
        <QrCode size={24} />
        <h2>{session.name}</h2>
        <p>{session.eventLocation}</p>
        <div className="admin-row">
          <span>Orders</span>
          <strong>{session.ordersEnabled ? "Enabled" : "Disabled"}</strong>
        </div>
        <div className="admin-row">
          <span>Waitlist</span>
          <strong>{session.contactCaptureEnabled ? "Enabled" : "Disabled"}</strong>
        </div>
      </article>
      <QRCodePanel url={orderUrl} eventName={session.name} />
    </section>
  );
}

function useReceiptContacts() {
  const [contacts, setContacts] = useState<ReceiptContactRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      watchReceiptContacts(
        (data) => {
          setContacts(data);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    []
  );
  return { contacts, error };
}

function useMarketingSignups() {
  const [signups, setSignups] = useState<MarketingSignupRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      watchMarketingSignups(
        (data) => {
          setSignups(data);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    []
  );
  return { signups, error };
}

interface MarketingContactRow {
  id: string;
  email: string;
  optedIn: boolean;
  source: "POS receipt" | "Landing page";
  reference: string;
  isTest: boolean;
  createdAtUtc: string;
}

function ContactsView() {
  const { contacts, error: contactsError } = useReceiptContacts();
  const { signups, error: signupsError } = useMarketingSignups();
  const error = contactsError ?? signupsError;

  const marketing: MarketingContactRow[] = [
    ...contacts.map((contact) => ({
      id: `receipt-${contact.id}`,
      email: contact.email,
      optedIn: contact.marketingOptIn,
      source: "POS receipt" as const,
      reference: contact.ticketNumber,
      isTest: contact.isTest,
      createdAtUtc: contact.createdAtUtc
    })),
    ...signups.map((signup) => ({
      id: `signup-${signup.id}`,
      email: signup.email,
      optedIn: true,
      source: "Landing page" as const,
      reference: "",
      isTest: false,
      createdAtUtc: signup.createdAtUtc
    }))
  ].sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? 1 : -1));
  const optedIn = marketing.filter((row) => row.optedIn);

  function exportMarketingCsv() {
    const header = ["Email", "Opted in", "Source", "Reference", "Collected"];
    const rows = marketing.map((row) => [
      row.email,
      row.optedIn ? "yes" : "no",
      row.source,
      row.reference + (row.isTest ? " (test)" : ""),
      formatBusinessDateTime(row.createdAtUtc)
    ]);
    downloadCsv(`bbt-marketing-contacts-${businessTodayKey()}.csv`, [header, ...rows]);
  }

  return (
    <section className="menu-manager">
      <article className="admin-card">
        <div className="toolbar">
          <h2>Marketing Contacts</h2>
          <button
            className="button button-ghost"
            type="button"
            onClick={exportMarketingCsv}
            disabled={marketing.length === 0}
          >
            <Download size={18} />
            Export CSV
          </button>
        </div>
        <div className="admin-row">
          <span>{marketing.length} collected</span>
          <strong>{optedIn.length} opted into updates</strong>
        </div>
        {error && <p className="muted">Contacts unavailable: {error}</p>}
        {!error && marketing.length === 0 && (
          <p className="muted">
            Emails from the POS receipt drawer and the /updates signup page will appear here.
          </p>
        )}
        {marketing.map((row) => (
          <article className="contact-row" key={row.id}>
            <Mail size={21} />
            <div>
              <strong>{row.email}</strong>
              <span>
                {row.optedIn ? "Opted into updates" : "Receipt only"} · {row.source}
                {row.reference ? ` · ${row.reference}` : ""}
                {row.isTest ? " · TEST" : ""}
              </span>
            </div>
            <small>{formatBusinessDateTime(row.createdAtUtc)}</small>
          </article>
        ))}
      </article>

      <article className="admin-card">
        <h2>Business &amp; Bulk Inquiries</h2>
        <p className="muted">
          Catering, events, wholesale, and waitlist requests from the website and vendor pages.
        </p>
        {contactSubmissions.map((contact) => (
          <article className="contact-row" key={contact.id}>
            <Users size={21} />
            <div>
              <strong>{contact.name}</strong>
              <span>{contact.contact} / {contact.productInterest} / {contact.approximateQuantity}</span>
            </div>
            <small>{formatBusinessDateTime(contact.createdAtUtc)}</small>
          </article>
        ))}
      </article>
    </section>
  );
}

const timezoneOptions = [
  { value: "America/Denver", label: "Mountain — America/Denver" },
  { value: "America/Phoenix", label: "Arizona — America/Phoenix" },
  { value: "America/Chicago", label: "Central — America/Chicago" },
  { value: "America/New_York", label: "Eastern — America/New_York" },
  { value: "America/Los_Angeles", label: "Pacific — America/Los_Angeles" },
  { value: "America/Anchorage", label: "Alaska — America/Anchorage" },
  { value: "Pacific/Honolulu", label: "Hawaii — Pacific/Honolulu" }
];

type SettingsTab = "account" | "business" | "inventory" | "payments" | "reports";

const settingsTabs: { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "business", label: "Business" },
  { id: "inventory", label: "Inventory" },
  { id: "payments", label: "Payments" },
  { id: "reports", label: "Reports" }
];

function SettingsView({
  payments,
  products,
  testMode
}: {
  payments: PaymentSettings;
  products: MenuProduct[];
  testMode: boolean;
}) {
  const [tab, setTab] = useState<SettingsTab>("account");

  return (
    <section className="reports-shell">
      <div className="report-tabs" role="tablist">
        {settingsTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`button button-small report-tab${tab === item.id ? " active" : ""}`}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "account" && (
        <article className="admin-card settings-list settings-panel">
          <KeyRound size={24} />
          <h2>Account Security</h2>
          <ChangePasswordForm />
        </article>
      )}
      {tab === "business" && (
        <div className="settings-layout">
          <BusinessSettingsCard />
          <OperatingModeCard testMode={testMode} />
        </div>
      )}
      {tab === "inventory" && <InventorySettings products={products} />}
      {tab === "payments" && <PaymentSettingsCard payments={payments} />}
      {tab === "reports" && <ReportSettingsTab />}
    </section>
  );
}

function OperatingModeCard({ testMode }: { testMode: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function setMode(next: boolean) {
    if (next === testMode || busy) return;
    setBusy(true);
    setError("");
    try {
      await saveTestMode(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the operating mode.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="admin-card settings-list">
      <FlaskConical size={24} />
      <h2>Operating Mode</h2>
      <p className="muted">
        One global switch for every signed-in device — the whole site is either live or in test
        mode. Test-mode sales are flagged as practice: they stay out of real orders, reports, and
        inventory, and can be wiped from the test banner.
      </p>
      <div className="button-row">
        <button
          className={`button ${!testMode ? "button-primary" : "button-ghost"}`}
          type="button"
          disabled={busy}
          onClick={() => setMode(false)}
        >
          {testMode ? "Switch to Live Mode" : "Live Mode (current)"}
        </button>
        <button
          className={`button ${testMode ? "button-primary" : "button-ghost"}`}
          type="button"
          disabled={busy}
          onClick={() => setMode(true)}
        >
          {testMode ? "Test Mode (current)" : "Switch to Test Mode"}
        </button>
      </div>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

function PaymentSettingsCard({ payments }: { payments: PaymentSettings }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);
    setError("");
    setSaving(true);
    try {
      await savePaymentSettings({
        cashAppCashtag: String(form.get("cashAppCashtag") ?? "").trim(),
        paypalMe: String(form.get("paypalMe") ?? "").trim(),
        venmoHandle: String(form.get("venmoHandle") ?? "").trim(),
        zelleContact: String(form.get("zelleContact") ?? "").trim(),
        applePayEnabled: form.get("applePayEnabled") === "on",
        applePayNote: String(form.get("applePayNote") ?? "").trim()
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save payment settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="admin-card settings-list settings-panel"
      // Remount when the stored accounts arrive so the fields pick up the
      // loaded values as their defaults.
      key={`${payments.cashAppCashtag}|${payments.paypalMe}|${payments.venmoHandle}|${payments.zelleContact}|${payments.applePayEnabled}|${payments.applePayNote}`}
      onSubmit={saveSettings}
    >
      <Settings size={24} />
      <h2>Payment Accounts</h2>
      <label>
        Cash App cashtag
        <input name="cashAppCashtag" defaultValue={payments.cashAppCashtag} />
      </label>
      <label>
        PayPal.Me name
        <input name="paypalMe" defaultValue={payments.paypalMe} />
      </label>
      <label>
        Venmo handle
        <input name="venmoHandle" defaultValue={payments.venmoHandle} />
      </label>
      <label>
        Zelle email or phone
        <input name="zelleContact" defaultValue={payments.zelleContact} />
      </label>
      <label>
        Apple Pay note
        <input name="applePayNote" defaultValue={payments.applePayNote} />
      </label>
      <label className="toggle-row">
        <input name="applePayEnabled" type="checkbox" defaultChecked={payments.applePayEnabled} />
        <span>Enable Apple Pay once merchant processing is ready</span>
      </label>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="form-notice" role="status">
          Payment accounts saved. The POS uses them immediately.
        </p>
      )}
      <button className="button button-primary" type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save Payment Settings"}
      </button>
    </form>
  );
}

function ReportSettingsTab() {
  const reporting = useReportingSettings();
  return <ReportSettingsCard reporting={reporting} />;
}

const adjustmentReasonLabels: Record<InventoryAdjustmentReason, string> = {
  restock: "Restock / production",
  loss: "Loss / waste",
  comp: "Comp / replacement",
  correction: "Count correction"
};

function useInventory() {
  const [levels, setLevels] = useState<InventoryLevel[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      watchInventory(
        (data) => {
          setLevels(data);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    []
  );
  return { levels, error };
}

function useInventoryAdjustments() {
  const [adjustments, setAdjustments] = useState<InventoryAdjustmentRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      watchInventoryAdjustments(
        (data) => {
          setAdjustments(data);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    []
  );
  return { adjustments, error };
}

function InventorySettings({ products }: { products: MenuProduct[] }) {
  const { levels, error: levelsError } = useInventory();
  const { adjustments, error: adjustmentsError } = useInventoryAdjustments();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  const levelByProduct = new Map(levels.map((level) => [level.productId, level]));
  const rows = [
    ...products.map((product) => ({
      productId: product.id,
      name: product.name,
      stock: levelByProduct.get(product.id)?.stockCount ?? 0
    })),
    ...levels
      .filter((level) => !products.some((product) => product.id === level.productId))
      .map((level) => ({
        productId: level.productId,
        name: `${level.productName} (off menu)`,
        stock: level.stockCount
      }))
  ];

  async function handleAdjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const productId = String(form.get("productId") ?? "");
    const product = products.find((item) => item.id === productId);
    const quantity = Math.round(Number(form.get("quantity")));
    const direction = String(form.get("direction") ?? "add");
    if (!product || !Number.isFinite(quantity) || quantity <= 0) {
      setFormError("Pick an item and a positive whole quantity.");
      return;
    }
    setBusy(true);
    setFormError("");
    try {
      await adjustInventory({
        productId,
        productName: product.name,
        delta: direction === "add" ? quantity : -quantity,
        reason: (form.get("reason") as InventoryAdjustmentReason) || "correction",
        note: String(form.get("note") ?? "").trim()
      });
      formElement.reset();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save the adjustment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-layout">
      <article className="admin-card settings-list">
        <Package size={24} />
        <h2>Stock Levels</h2>
        <p className="muted">
          POS sales pull from stock automatically; voiding or deleting a ticket puts its items
          back. Test-mode sales never touch stock.
        </p>
        {levelsError && <p className="muted">Stock unavailable: {levelsError}</p>}
        {rows.map((row) => (
          <div className="admin-row" key={row.productId}>
            <span>{row.name}</span>
            <strong className={row.stock <= 0 ? "stock-out" : ""}>{row.stock} in stock</strong>
          </div>
        ))}
      </article>

      <article className="admin-card settings-list">
        <h2>Adjust Stock</h2>
        <form className="settings-list" onSubmit={handleAdjust}>
          <label>
            Item
            <select name="productId" required defaultValue="">
              <option value="" disabled>
                Choose an item…
              </option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Action
            <select name="direction" defaultValue="add">
              <option value="add">Add to stock</option>
              <option value="remove">Remove from stock</option>
            </select>
          </label>
          <label>
            Quantity
            <input name="quantity" type="number" min="1" step="1" inputMode="numeric" required />
          </label>
          <label>
            Reason
            <select name="reason" defaultValue="restock">
              {(Object.keys(adjustmentReasonLabels) as InventoryAdjustmentReason[]).map(
                (reason) => (
                  <option key={reason} value={reason}>
                    {adjustmentReasonLabels[reason]}
                  </option>
                )
              )}
            </select>
          </label>
          <label>
            Note
            <input name="note" placeholder="e.g. Saturday batch, dropped tray, replaced order" />
          </label>
          {formError && (
            <p className="form-notice form-notice-error" role="alert">
              {formError}
            </p>
          )}
          <button className="button button-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Apply Adjustment"}
          </button>
        </form>
        <h3 className="report-subhead">Recent adjustments</h3>
        {adjustmentsError && <p className="muted">History unavailable: {adjustmentsError}</p>}
        {adjustments.length === 0 ? (
          <p className="muted">No manual adjustments yet.</p>
        ) : (
          adjustments.map((adjustment) => (
            <div className="admin-row" key={adjustment.id}>
              <span>
                {adjustment.productName} · {adjustmentReasonLabels[adjustment.reason]}
                {adjustment.note ? ` — ${adjustment.note}` : ""}
              </span>
              <strong>{adjustment.delta > 0 ? `+${adjustment.delta}` : adjustment.delta}</strong>
            </div>
          ))
        )}
      </article>
    </div>
  );
}

function BusinessSettingsCard() {
  const business = useBusinessSettings();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const taxPercent = Number(form.get("taxRate"));
    setSaved(false);
    setError("");
    if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 25) {
      setError("Enter the tax rate as a percentage between 0 and 25, e.g. 8.7.");
      return;
    }
    setSaving(true);
    try {
      await saveBusinessSettings({
        timezone: String(form.get("timezone") ?? business.timezone),
        taxRateBps: Math.round(taxPercent * 100),
        contactPhone: String(form.get("contactPhone") ?? "").trim(),
        contactEmail: String(form.get("contactEmail") ?? "").trim(),
        instagramHandle: String(form.get("instagramHandle") ?? "").trim()
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save business settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="admin-card settings-list"
      // Remount the form when the stored settings arrive so the fields pick
      // up the loaded values as their defaults.
      key={`${business.timezone}|${business.taxRateBps}|${business.contactPhone}|${business.contactEmail}|${business.instagramHandle}`}
      onSubmit={handleSubmit}
    >
      <CreditCard size={24} />
      <h2>Business Settings</h2>
      <label>
        Timezone
        <select name="timezone" defaultValue={business.timezone}>
          {timezoneOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tax rate (%)
        <input
          name="taxRate"
          type="number"
          min="0"
          max="25"
          step="0.01"
          inputMode="decimal"
          defaultValue={(business.taxRateBps / 100).toString()}
          required
        />
      </label>
      <label>
        Contact phone
        <input name="contactPhone" type="tel" defaultValue={business.contactPhone} />
      </label>
      <label>
        Contact email
        <input name="contactEmail" type="email" defaultValue={business.contactEmail} />
      </label>
      <label>
        Instagram handle
        <input name="instagramHandle" defaultValue={business.instagramHandle} placeholder="@banginbustostamales" />
      </label>
      {error && (
        <p className="form-notice form-notice-error" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="form-notice" role="status">
          Business settings saved. The POS and website use them immediately.
        </p>
      )}
      <button className="button button-primary" type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save Business Settings"}
      </button>
    </form>
  );
}

function useReportingSettings(): ReportingSettings {
  const [settings, setSettings] = useState<ReportingSettings>(reportingDefaults);
  useEffect(() => watchReportingSettings(setSettings, () => undefined), []);
  return settings;
}

function useExpenses() {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      watchExpenses(
        (data) => {
          setExpenses(data);
          setError(null);
        },
        (err) => setError(err.message)
      ),
    []
  );
  return { expenses, error };
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

function ReportLine({
  label,
  cents,
  indent = false,
  total = false,
  negative = false
}: {
  label: string;
  cents: number;
  indent?: boolean;
  total?: boolean;
  negative?: boolean;
}) {
  return (
    <div className={`report-line${indent ? " indent" : ""}${total ? " total" : ""}`}>
      <span>{label}</span>
      <strong>{negative ? `(${formatMoney(cents)})` : formatMoney(cents)}</strong>
    </div>
  );
}

type ReportTab = "income" | "balance" | "tax" | "expenses";

const reportTabs: { id: ReportTab; label: string }[] = [
  { id: "income", label: "Income Statement" },
  { id: "balance", label: "Balance Sheet" },
  { id: "tax", label: "Sales & Use Tax" },
  { id: "expenses", label: "Expenses" }
];

function ReportsView({ pos }: { pos: PosState }) {
  const business = useBusinessSettings();
  const reporting = useReportingSettings();
  const { expenses, error: expensesError } = useExpenses();
  const [tab, setTab] = useState<ReportTab>("income");
  const [periodId, setPeriodId] = useState<PeriodId>("this_month");

  const periods = getPeriods();
  const period = periods.find((item) => item.id === periodId) ?? periods[periods.length - 1];
  const paid = pos.tickets.filter((ticket) => ticket.status === "paid");
  const periodTickets = ticketsInPeriod(paid, period);
  const periodExpenses = expensesInPeriod(expenses, period);
  const usesPeriod = tab === "income" || tab === "tax" || tab === "expenses";

  function exportRawSalesCsv() {
    const header = ["Ticket", "Name", "Date", "Payment", "Items", "Net Sale", "Tax", "Total"];
    const rows = periodTickets.map((ticket) => [
      ticket.ticketNumber,
      ticket.customerName,
      formatBusinessDateTime(ticket.createdAtUtc),
      paymentLabels[ticket.paymentMethod],
      ticket.items.map((item) => `${item.quantity}x ${item.productName}`).join("; "),
      dollars(ticket.subtotalCents),
      dollars(ticket.taxCents),
      dollars(ticket.totalCents)
    ]);
    downloadCsv(`bbt-sales-${period.id}-${businessTodayKey()}.csv`, [header, ...rows]);
  }

  return (
    <section className="reports-shell">
      <div className="report-tabs" role="tablist">
        {reportTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`button button-small report-tab${tab === item.id ? " active" : ""}`}
            aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {usesPeriod && (
        <div className="report-toolbar">
          <label className="report-period">
            Period
            <select value={periodId} onChange={(event) => setPeriodId(event.target.value as PeriodId)}>
              {periods.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-ghost"
            type="button"
            onClick={exportRawSalesCsv}
            disabled={periodTickets.length === 0}
          >
            <Download size={18} />
            Raw sales CSV
          </button>
        </div>
      )}

      {pos.error && <p className="muted">Sales unavailable: {pos.error}</p>}
      {expensesError && tab !== "balance" && (
        <p className="muted">Expenses unavailable: {expensesError}</p>
      )}

      {tab === "income" && (
        <IncomeStatementCard
          businessName={business.name}
          period={period}
          tickets={periodTickets}
          expenses={periodExpenses}
          reporting={reporting}
        />
      )}
      {tab === "balance" && (
        <BalanceSheetCard businessName={business.name} tickets={paid} reporting={reporting} />
      )}
      {tab === "tax" && (
        <SalesTaxCard
          businessName={business.name}
          period={period}
          tickets={periodTickets}
          taxRateBps={business.taxRateBps}
          reporting={reporting}
        />
      )}
      {tab === "expenses" && <ExpensesCard period={period} expenses={periodExpenses} />}
    </section>
  );
}

function IncomeStatementCard({
  businessName,
  period,
  tickets,
  expenses,
  reporting
}: {
  businessName: string;
  period: Period;
  tickets: PosTicketRecord[];
  expenses: ExpenseRecord[];
  reporting: ReportingSettings;
}) {
  const statement = buildIncomeStatement(tickets, expenses, reporting);
  const sharePercent = reporting.revenueShareBps / 100;

  function exportCsv() {
    const rows: string[][] = [
      [businessName, ""],
      ["Income Statement", periodRangeLabel(period)],
      ["", ""],
      ["Gross receipts", dollars(statement.grossReceiptsCents)],
      ["Less: sales tax collected", `(${dollars(statement.salesTaxCents)})`],
      ["Net sales", dollars(statement.netSalesCents)],
      ["", ""],
      [`Admin revenue share (${sharePercent}% of net sales)`, dollars(statement.adminShareCents)],
      ...statement.expenseLines.map((line) => [line.label, dollars(line.amountCents)]),
      ["Total expenses", dollars(statement.totalExpensesCents)],
      ["", ""],
      ["Owner net income", dollars(statement.ownerNetIncomeCents)]
    ];
    downloadCsv(`bbt-income-statement-${period.id}-${businessTodayKey()}.csv`, rows);
  }

  return (
    <article className="admin-card report-card">
      <header className="report-heading">
        <p className="eyebrow">{businessName}</p>
        <h2>Income Statement</h2>
        <p className="muted">{periodRangeLabel(period)}</p>
      </header>
      <div className="report-lines">
        <ReportLine label="Gross receipts" cents={statement.grossReceiptsCents} />
        <ReportLine
          label="Less: sales tax collected"
          cents={statement.salesTaxCents}
          indent
          negative
        />
        <ReportLine label="Net sales" cents={statement.netSalesCents} total />
      </div>
      <h3 className="report-subhead">Expenses</h3>
      <div className="report-lines">
        <ReportLine
          label={`Admin revenue share (${sharePercent}% of net sales)`}
          cents={statement.adminShareCents}
          indent
        />
        {statement.expenseLines.map((line) => (
          <ReportLine key={line.category} label={line.label} cents={line.amountCents} indent />
        ))}
        <ReportLine label="Total expenses" cents={statement.totalExpensesCents} total />
        <ReportLine label="Owner net income" cents={statement.ownerNetIncomeCents} total />
      </div>
      <div className="order-group-stats report-split">
        <div>
          <span>Owner net income</span>
          <strong>{formatMoney(statement.ownerNetIncomeCents)}</strong>
        </div>
        <div>
          <span>Admin share ({sharePercent}%)</span>
          <strong>{formatMoney(statement.adminShareCents)}</strong>
        </div>
        <div>
          <span>Sales tax set aside</span>
          <strong>{formatMoney(statement.salesTaxCents)}</strong>
        </div>
        <div>
          <span>Operating expenses</span>
          <strong>{formatMoney(statement.operatingExpensesCents)}</strong>
        </div>
      </div>
      <button className="button button-primary" type="button" onClick={exportCsv}>
        <Download size={18} />
        Export Income Statement
      </button>
    </article>
  );
}

function BalanceSheetCard({
  businessName,
  tickets,
  reporting
}: {
  businessName: string;
  tickets: PosTicketRecord[];
  reporting: ReportingSettings;
}) {
  const sheet = buildBalanceSheet(tickets, reporting);

  function exportCsv() {
    const rows: string[][] = [
      [businessName, ""],
      ["Balance Sheet", `As of ${sheet.asOfKey}`],
      ["", ""],
      ["Assets", ""],
      ["Cash on hand", dollars(sheet.cashOnHandCents)],
      ["Equipment", dollars(sheet.equipmentAssetsCents)],
      ["Other assets", dollars(sheet.otherAssetsCents)],
      ["Total assets", dollars(sheet.totalAssetsCents)],
      ["", ""],
      ["Liabilities", ""],
      ["Sales tax payable", dollars(sheet.salesTaxPayableCents)],
      ["Admin revenue share payable", dollars(sheet.adminSharePayableCents)],
      ["Other liabilities", dollars(sheet.otherLiabilitiesCents)],
      ["Total liabilities", dollars(sheet.totalLiabilitiesCents)],
      ["", ""],
      ["Owner's equity", dollars(sheet.ownerEquityCents)]
    ];
    downloadCsv(`bbt-balance-sheet-${sheet.asOfKey}.csv`, rows);
  }

  return (
    <article className="admin-card report-card">
      <header className="report-heading">
        <p className="eyebrow">{businessName}</p>
        <h2>Balance Sheet</h2>
        <p className="muted">As of {sheet.asOfKey}</p>
      </header>
      <h3 className="report-subhead">Assets</h3>
      <div className="report-lines">
        <ReportLine label="Cash on hand" cents={sheet.cashOnHandCents} indent />
        <ReportLine label="Equipment" cents={sheet.equipmentAssetsCents} indent />
        <ReportLine label="Other assets" cents={sheet.otherAssetsCents} indent />
        <ReportLine label="Total assets" cents={sheet.totalAssetsCents} total />
      </div>
      <h3 className="report-subhead">Liabilities</h3>
      <div className="report-lines">
        <ReportLine label="Sales tax payable" cents={sheet.salesTaxPayableCents} indent />
        <ReportLine label="Admin revenue share payable" cents={sheet.adminSharePayableCents} indent />
        <ReportLine label="Other liabilities" cents={sheet.otherLiabilitiesCents} indent />
        <ReportLine label="Total liabilities" cents={sheet.totalLiabilitiesCents} total />
      </div>
      <h3 className="report-subhead">Equity</h3>
      <div className="report-lines">
        <ReportLine label="Owner's equity (assets − liabilities)" cents={sheet.ownerEquityCents} total />
      </div>
      <p className="muted">
        Cash, equipment, and other asset/liability values come from Report Settings. Sales tax
        payable and admin share payable are calculated from all-time sales minus what you've
        recorded as remitted/paid.
      </p>
      <button className="button button-primary" type="button" onClick={exportCsv}>
        <Download size={18} />
        Export Balance Sheet
      </button>
    </article>
  );
}

function SalesTaxCard({
  businessName,
  period,
  tickets,
  taxRateBps,
  reporting
}: {
  businessName: string;
  period: Period;
  tickets: PosTicketRecord[];
  taxRateBps: number;
  reporting: ReportingSettings;
}) {
  const report = buildSalesTaxReport(tickets, taxRateBps);

  function exportCsv() {
    const rows: string[][] = [
      [businessName, ""],
      ["Sales & Use Tax Report", periodRangeLabel(period)],
      ["Jurisdiction", reporting.taxJurisdiction || "—"],
      ["Tax account #", reporting.taxAccountNumber || "—"],
      ["Filing frequency", reporting.filingFrequency],
      ["", ""],
      ["Gross sales (excluding tax)", dollars(report.grossSalesCents)],
      ["Exempt sales", dollars(report.exemptSalesCents)],
      ["Taxable sales", dollars(report.taxableSalesCents)],
      ["Tax rate", `${report.taxRateBps / 100}%`],
      ["Tax calculated at rate", dollars(report.taxCalculatedCents)],
      ["Tax actually collected", dollars(report.taxCollectedCents)],
      ["Rounding difference", dollars(report.roundingDifferenceCents)]
    ];
    downloadCsv(`bbt-sales-tax-${period.id}-${businessTodayKey()}.csv`, rows);
  }

  return (
    <article className="admin-card report-card">
      <header className="report-heading">
        <p className="eyebrow">{businessName}</p>
        <h2>Sales &amp; Use Tax Report</h2>
        <p className="muted">{periodRangeLabel(period)}</p>
      </header>
      <div className="report-lines">
        <div className="report-line">
          <span>Jurisdiction</span>
          <strong>{reporting.taxJurisdiction || "Set in Report Settings"}</strong>
        </div>
        <div className="report-line">
          <span>Tax account #</span>
          <strong>{reporting.taxAccountNumber || "Set in Report Settings"}</strong>
        </div>
        <div className="report-line">
          <span>Filing frequency</span>
          <strong>{reporting.filingFrequency}</strong>
        </div>
      </div>
      <h3 className="report-subhead">Return figures</h3>
      <div className="report-lines">
        <ReportLine label="Gross sales (excluding tax)" cents={report.grossSalesCents} indent />
        <ReportLine label="Exempt sales" cents={report.exemptSalesCents} indent />
        <ReportLine label="Taxable sales" cents={report.taxableSalesCents} total />
        <div className="report-line indent">
          <span>Tax rate</span>
          <strong>{report.taxRateBps / 100}%</strong>
        </div>
        <ReportLine label="Tax calculated at rate" cents={report.taxCalculatedCents} indent />
        <ReportLine label="Tax actually collected" cents={report.taxCollectedCents} total />
        <ReportLine label="Rounding difference" cents={report.roundingDifferenceCents} indent />
      </div>
      <button className="button button-primary" type="button" onClick={exportCsv}>
        <Download size={18} />
        Export Tax Report
      </button>
    </article>
  );
}

function ExpensesCard({ period, expenses }: { period: Period; expenses: ExpenseRecord[] }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const totalCents = expenses.reduce((sum, expense) => sum + expense.amountCents, 0);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amountCents = Math.round(Number(form.get("amount")) * 100);
    const dateKey = String(form.get("date") ?? "");
    if (!dateKey || !Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Enter a date and a positive amount.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      await addExpense({
        dateKey,
        category: (form.get("category") as ExpenseCategory) || "other",
        amountCents,
        note: String(form.get("note") ?? "").trim()
      });
      formElement.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the expense.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(expense: ExpenseRecord) {
    if (!window.confirm(`Delete ${formatMoney(expense.amountCents)} ${expenseCategoryLabels[expense.category]}?`)) {
      return;
    }
    try {
      await deleteExpense(expense.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the expense.");
    }
  }

  return (
    <article className="admin-card report-card">
      <h2>Expenses</h2>
      <form className="form-grid expense-form" onSubmit={handleAdd}>
        <label>
          Date
          <input name="date" type="date" defaultValue={businessTodayKey()} required />
        </label>
        <label>
          Category
          <select name="category" defaultValue="ingredients">
            {(Object.keys(expenseCategoryLabels) as ExpenseCategory[]).map((category) => (
              <option key={category} value={category}>
                {expenseCategoryLabels[category]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount ($)
          <input name="amount" type="number" min="0.01" step="0.01" inputMode="decimal" required />
        </label>
        <label>
          Note
          <input name="note" placeholder="e.g. masa, husks, propane" />
        </label>
        {error && (
          <p className="form-notice form-notice-error full-span" role="alert">
            {error}
          </p>
        )}
        <div className="button-row full-span">
          <button className="button button-primary" type="submit" disabled={busy}>
            <Plus size={18} />
            {busy ? "Saving…" : "Add Expense"}
          </button>
        </div>
      </form>

      <div className="admin-row">
        <span>
          {expenses.length} expense{expenses.length === 1 ? "" : "s"} · {periodRangeLabel(period)}
        </span>
        <strong>{formatMoney(totalCents)}</strong>
      </div>
      {expenses.length === 0 ? (
        <p className="muted">No expenses recorded for this period.</p>
      ) : (
        expenses.map((expense) => (
          <div className="expense-row" key={expense.id}>
            <span>{expense.dateKey}</span>
            <div>
              <strong>{expenseCategoryLabels[expense.category]}</strong>
              {expense.note && <span className="muted"> — {expense.note}</span>}
            </div>
            <strong>{formatMoney(expense.amountCents)}</strong>
            <button
              className="button button-small"
              type="button"
              aria-label="Delete expense"
              onClick={() => handleDelete(expense)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))
      )}
    </article>
  );
}

function ReportSettingsCard({ reporting }: { reporting: ReportingSettings }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const sharePercent = Number(form.get("revenueShare"));
    setSaved(false);
    setError("");
    if (!Number.isFinite(sharePercent) || sharePercent < 0 || sharePercent > 100) {
      setError("Enter the revenue share as a percentage between 0 and 100.");
      return;
    }
    const toCents = (name: string) => {
      const value = Number(form.get(name) || "0");
      return Number.isFinite(value) ? Math.round(value * 100) : 0;
    };
    setSaving(true);
    try {
      await saveReportingSettings({
        revenueShareBps: Math.round(sharePercent * 100),
        taxJurisdiction: String(form.get("taxJurisdiction") ?? "").trim(),
        taxAccountNumber: String(form.get("taxAccountNumber") ?? "").trim(),
        filingFrequency: (form.get("filingFrequency") as FilingFrequency) || "quarterly",
        cashOnHandCents: toCents("cashOnHand"),
        equipmentAssetsCents: toCents("equipmentAssets"),
        otherAssetsCents: toCents("otherAssets"),
        otherLiabilitiesCents: toCents("otherLiabilities"),
        taxRemittedToDateCents: toCents("taxRemittedToDate"),
        adminSharePaidToDateCents: toCents("adminSharePaidToDate")
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save report settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="admin-card report-card form-grid"
      key={JSON.stringify(reporting)}
      onSubmit={handleSubmit}
    >
      <h2 className="full-span">Report Settings</h2>
      <label>
        Admin revenue share (%)
        <input
          name="revenueShare"
          type="number"
          min="0"
          max="100"
          step="0.1"
          inputMode="decimal"
          defaultValue={(reporting.revenueShareBps / 100).toString()}
          required
        />
      </label>
      <label>
        Filing frequency
        <select name="filingFrequency" defaultValue={reporting.filingFrequency}>
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="annually">Annually</option>
        </select>
      </label>
      <label>
        Tax jurisdiction
        <input
          name="taxJurisdiction"
          defaultValue={reporting.taxJurisdiction}
          placeholder="e.g. Colorado / City of Westminster"
        />
      </label>
      <label>
        Sales tax account #
        <input name="taxAccountNumber" defaultValue={reporting.taxAccountNumber} />
      </label>
      <label>
        Cash on hand ($)
        <input
          name="cashOnHand"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          defaultValue={dollars(reporting.cashOnHandCents)}
        />
      </label>
      <label>
        Equipment value ($)
        <input
          name="equipmentAssets"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          defaultValue={dollars(reporting.equipmentAssetsCents)}
        />
      </label>
      <label>
        Other assets ($)
        <input
          name="otherAssets"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          defaultValue={dollars(reporting.otherAssetsCents)}
        />
      </label>
      <label>
        Other liabilities ($)
        <input
          name="otherLiabilities"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          defaultValue={dollars(reporting.otherLiabilitiesCents)}
        />
      </label>
      <label>
        Sales tax remitted to date ($)
        <input
          name="taxRemittedToDate"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          defaultValue={dollars(reporting.taxRemittedToDateCents)}
        />
      </label>
      <label>
        Admin share paid to date ($)
        <input
          name="adminSharePaidToDate"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          defaultValue={dollars(reporting.adminSharePaidToDateCents)}
        />
      </label>
      {error && (
        <p className="form-notice form-notice-error full-span" role="alert">
          {error}
        </p>
      )}
      {saved && (
        <p className="form-notice full-span" role="status">
          Report settings saved.
        </p>
      )}
      <div className="button-row full-span">
        <button className="button button-primary" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save Report Settings"}
        </button>
      </div>
    </form>
  );
}
