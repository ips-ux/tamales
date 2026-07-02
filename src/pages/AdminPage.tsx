import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  FlaskConical,
  KeyRound,
  Package,
  Pencil,
  Plus,
  QrCode,
  Settings,
  Trash2,
  Users,
  X
} from "lucide-react";
import { Dispatch, FormEvent, SetStateAction, useEffect, useState } from "react";
import { ChangePasswordForm } from "../components/ChangePasswordForm";
import { ImagePicker } from "../components/ImagePicker";
import { QRCodePanel } from "../components/QRCodePanel";
import {
  availabilityWindows,
  contactSubmissions,
  menuProducts,
  paymentSettings as initialPaymentSettings,
  pickupLocations,
  vendorSessions
} from "../data/fixtures";
import { useBusinessSettings } from "../lib/businessSettings";
import { downloadCsv } from "../lib/csv";
import {
  saveBusinessSettings,
  savePosTicket,
  watchPosTickets,
  type PosPaymentMethod,
  type PosTicketRecord
} from "../lib/firestoreClient";
import { formatMoney } from "../lib/money";
import { businessDateKey, businessTodayKey, formatBusinessDateTime, formatWindow } from "../lib/time";
import type {
  MenuProduct,
  MenuVariant,
  PaymentSettings,
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
  if (path.includes("/orders")) return "Orders";
  if (path.includes("/menu")) return "Menu";
  if (path.includes("/availability")) return "Availability";
  if (path.includes("/vendor")) return "Vendor";
  if (path.includes("/contacts")) return "Contacts";
  if (path.includes("/settings")) return "Settings";
  if (path.includes("/exports")) return "Exports";
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

const TEST_MODE_KEY = "bbt-test-mode";

export function AdminPage({ path }: AdminPageProps) {
  const [products, setProducts] = useState<MenuProduct[]>(menuProducts);
  const [payments, setPayments] = useState<PaymentSettings>(initialPaymentSettings);
  const [testMode, setTestMode] = useState(() => localStorage.getItem(TEST_MODE_KEY) === "1");
  const rawPos = usePosTickets();
  const title = adminTitle(path);

  // Every admin view sees only the current mode's tickets: real sales normally,
  // practice sales while test mode is on.
  const pos: PosState = {
    ...rawPos,
    tickets: rawPos.tickets.filter((ticket) => ticket.isTest === testMode)
  };

  function toggleTestMode() {
    setTestMode((current) => {
      const next = !current;
      localStorage.setItem(TEST_MODE_KEY, next ? "1" : "0");
      return next;
    });
  }

  return (
    <main className="admin-shell">
      <section className="admin-heading">
        <p className="eyebrow">Owner Area</p>
        <h1>{title}</h1>
        <label className="toggle-row test-mode-toggle">
          <input type="checkbox" checked={testMode} onChange={toggleTestMode} />
          <span>Test mode</span>
        </label>
      </section>

      {testMode && (
        <div className="test-mode-banner" role="status">
          <FlaskConical size={20} />
          Test mode — sales you take now are practice only and stay out of real reports.
        </div>
      )}

      {title === "Dashboard" && <Dashboard pos={pos} products={products} />}
      {title === "Live POS" && <PosView products={products} payments={payments} testMode={testMode} />}
      {title === "Orders" && <OrdersView pos={pos} />}
      {title === "Menu" && <MenuView products={products} setProducts={setProducts} />}
      {title === "Availability" && <AvailabilityView />}
      {title === "Vendor" && <VendorAdminView />}
      {title === "Contacts" && <ContactsView />}
      {title === "Settings" && <SettingsView payments={payments} setPayments={setPayments} />}
      {title === "Exports" && <ExportsView pos={pos} />}
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
  const [checkout, setCheckout] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    setCheckout(false);
    setTicketOpen(false);
    setMethod("cash");
    setSaveError(null);
  }

  async function handleMarkPaid() {
    if (items.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await savePosTicket({
        items,
        subtotalCents,
        taxCents,
        totalCents,
        paymentMethod: method,
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
        <div className="pos-ticket-header">
          <div>
            <p className="eyebrow">{testMode ? "Test Ticket" : "Live Ticket"}</p>
            <h2>{formatMoney(totalCents)}</h2>
          </div>
          <div className="button-row">
            <button className="button button-small" type="button" onClick={clearTicket} disabled={items.length === 0}>
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

        <div className="pos-ticket-lines">
          {items.length === 0 ? (
            <p className="muted">Tap menu items to build the ticket.</p>
          ) : (
            items.map((item) => (
              <div className="pos-ticket-line" key={item.productId}>
                <div>
                  <strong>{item.productName}</strong>
                  <span>{formatMoney(item.unitPriceCents)} each</span>
                </div>
                <div className="pos-qty">
                  <button type="button" onClick={() => updateItem(item.productId, item.quantity - 1)}>
                    -
                  </button>
                  <output>{item.quantity}</output>
                  <button type="button" onClick={() => updateItem(item.productId, item.quantity + 1)}>
                    +
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pos-totals">
          <div>
            <span>Subtotal</span>
            <strong>{formatMoney(subtotalCents)}</strong>
          </div>
          <div>
            <span>Tax</span>
            <strong>{formatMoney(taxCents)}</strong>
          </div>
          <div>
            <span>Total</span>
            <strong>{formatMoney(totalCents)}</strong>
          </div>
        </div>

        {!checkout ? (
          <button
            className="button button-primary pos-checkout"
            type="button"
            disabled={items.length === 0}
            onClick={() => setCheckout(true)}
          >
            Checkout
          </button>
        ) : (
          <div className="pos-checkout-panel">
            <fieldset>
              <legend>Payment platform</legend>
              {(Object.keys(paymentLabels) as PaymentMethod[]).map((key) => (
                <label className={key === "applepay" && !payments.applePayEnabled ? "choice-disabled" : ""} key={key}>
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
              <QRCodePanel
                url={methodUrl(method, payments, totalCents)}
                title={`Pay with ${paymentLabels[method]}`}
                eventName={formatMoney(totalCents)}
                alt={`QR code for ${paymentLabels[method]} payment`}
              />
            )}
            {saveError && <p className="muted">Could not save: {saveError}</p>}
            <button
              className="button button-primary"
              type="button"
              onClick={handleMarkPaid}
              disabled={saving}
            >
              {saving ? "Saving…" : "Mark Paid + New Ticket"}
            </button>
          </div>
        )}
      </aside>

      <div className="pos-bar">
        <button
          className="pos-bar-summary"
          type="button"
          onClick={() => setTicketOpen(true)}
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
            setCheckout(true);
            setTicketOpen(true);
          }}
        >
          Charge {formatMoney(totalCents)}
        </button>
      </div>
    </section>
  );
}

function OrdersView({ pos }: { pos: PosState }) {
  const [group, setGroup] = useState<"overview" | "pos" | "preorders">("overview");
  const todayKey = businessTodayKey();
  const paid = pos.tickets.filter((ticket) => ticket.status === "paid");
  const paidToday = paid.filter((ticket) => businessDateKey(ticket.createdAtUtc) === todayKey);
  const revenueToday = paidToday.reduce((sum, ticket) => sum + ticket.totalCents, 0);
  const revenueAllTime = paid.reduce((sum, ticket) => sum + ticket.totalCents, 0);
  const lastSale = paid[0];

  if (group === "pos") {
    return <PosOrdersDetail pos={pos} onBack={() => setGroup("overview")} />;
  }

  if (group === "preorders") {
    return (
      <section className="admin-card">
        <div className="toolbar">
          <button className="button button-small" type="button" onClick={() => setGroup("overview")}>
            <ArrowLeft size={16} />
            All orders
          </button>
        </div>
        <h2>Batch Pre-orders</h2>
        <p className="muted">
          Coming soon. When the website preorder checkout goes live, batch orders will land here
          with customer details, pickup windows, and status tracking from confirmation to handoff.
        </p>
      </section>
    );
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
          <span className="status-badge product-status-sold_out">Coming soon</span>
        </div>
        <div className="order-group-stats">
          <div>
            <span>Open orders</span>
            <strong>0</strong>
          </div>
          <div>
            <span>Committed batches</span>
            <strong>0</strong>
          </div>
        </div>
        <p className="muted">
          Website preorder checkout isn't live yet. Half-dozen and dozen batch orders will be
          confirmed and tracked here.
        </p>
        <span className="order-group-cta">
          Preview
          <ChevronRight size={18} />
        </span>
      </button>
    </section>
  );
}

function PosOrdersDetail({ pos, onBack }: { pos: PosState; onBack: () => void }) {
  const paid = pos.tickets.filter((ticket) => ticket.status === "paid");
  const revenueAllTime = paid.reduce((sum, ticket) => sum + ticket.totalCents, 0);

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
      ) : paid.length === 0 ? (
        <p className="muted">No POS sales yet. Ring one up in Live POS.</p>
      ) : (
        <>
          <div className="admin-row">
            <span>{paid.length} sales</span>
            <strong>{formatMoney(revenueAllTime)}</strong>
          </div>
          {paid.map((ticket) => (
            <div className="production-row" key={ticket.id}>
              <span>{ticket.ticketNumber}</span>
              <strong>{formatBusinessDateTime(ticket.createdAtUtc)}</strong>
              <span>
                {ticket.items.map((item) => `${item.quantity} ${item.productName}`).join(", ")}
              </span>
              <span>{paymentLabels[ticket.paymentMethod]}</span>
              <strong>{formatMoney(ticket.totalCents)}</strong>
            </div>
          ))}
        </>
      )}
    </section>
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

function MenuView({
  products,
  setProducts
}: {
  products: MenuProduct[];
  setProducts: Dispatch<SetStateAction<MenuProduct[]>>;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  function addProduct(product: MenuProduct) {
    setProducts((current) => [...current, { ...product, sortOrder: current.length + 1 }]);
    setAdding(false);
  }

  function saveProduct(updated: MenuProduct) {
    setProducts((current) => current.map((product) => (product.id === updated.id ? updated : product)));
    setEditingId(null);
  }

  function removeProduct(id: string) {
    setProducts((current) => current.filter((product) => product.id !== id));
  }

  function toggleBulk(id: string) {
    setProducts((current) =>
      current.map((product) =>
        product.id === id ? { ...product, bulkMenuEnabled: !product.bulkMenuEnabled } : product
      )
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
              onRemove={() => removeProduct(product.id)}
              onToggleBulk={() => toggleBulk(product.id)}
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
    <section className="admin-grid">
      {availabilityWindows.map((window) => {
        const location = pickupLocations.find((item) => item.id === window.locationId);
        return (
          <article className="admin-card" key={window.id}>
            <CalendarDays size={24} />
            <h2>{window.label}</h2>
            <p>{formatWindow(window)}</p>
            <div className="admin-row">
              <span>{location?.name}</span>
              <strong>{window.capacity - window.committedOrders} open</strong>
            </div>
            <p>{window.instructions}</p>
          </article>
        );
      })}
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

function ContactsView() {
  return (
    <section className="admin-card">
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

function SettingsView({
  payments,
  setPayments
}: {
  payments: PaymentSettings;
  setPayments: Dispatch<SetStateAction<PaymentSettings>>;
}) {
  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPayments({
      id: "default",
      cashAppCashtag: String(form.get("cashAppCashtag") ?? ""),
      paypalMe: String(form.get("paypalMe") ?? ""),
      venmoHandle: String(form.get("venmoHandle") ?? ""),
      zelleContact: String(form.get("zelleContact") ?? ""),
      applePayEnabled: form.get("applePayEnabled") === "on",
      applePayNote: String(form.get("applePayNote") ?? "")
    });
  }

  return (
    <section className="settings-layout">
      <form className="admin-card settings-list" onSubmit={saveSettings}>
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
        <button className="button button-primary" type="submit">
          Save Payment Settings
        </button>
      </form>
      <article className="admin-card settings-list">
        <KeyRound size={24} />
        <h2>Account Security</h2>
        <ChangePasswordForm />
      </article>
      <BusinessSettingsCard />
    </section>
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

function ExportsView({ pos }: { pos: PosState }) {
  const paid = pos.tickets.filter((ticket) => ticket.status === "paid");
  const totalCents = paid.reduce((sum, ticket) => sum + ticket.totalCents, 0);

  function exportCsv() {
    const header = ["Ticket", "Date (Denver)", "Payment", "Items", "Subtotal", "Tax", "Total"];
    const rows = paid.map((ticket) => [
      ticket.ticketNumber,
      formatBusinessDateTime(ticket.createdAtUtc),
      paymentLabels[ticket.paymentMethod],
      ticket.items.map((item) => `${item.quantity}x ${item.productName}`).join("; "),
      (ticket.subtotalCents / 100).toFixed(2),
      (ticket.taxCents / 100).toFixed(2),
      (ticket.totalCents / 100).toFixed(2)
    ]);
    downloadCsv(`bbt-pos-sales-${businessTodayKey()}.csv`, [header, ...rows]);
  }

  return (
    <section className="admin-card">
      <FileText size={24} />
      <div className="toolbar">
        <h2>POS Sales Report</h2>
        <button
          className="button button-primary"
          type="button"
          onClick={exportCsv}
          disabled={paid.length === 0}
        >
          <Download size={18} />
          Export CSV
        </button>
      </div>
      {pos.loading ? (
        <p className="muted">Loading sales…</p>
      ) : pos.error ? (
        <p className="muted">Sales unavailable: {pos.error}</p>
      ) : paid.length === 0 ? (
        <p className="muted">No sales recorded yet. Take one in Live POS.</p>
      ) : (
        <>
          <div className="admin-row">
            <span>{paid.length} sales</span>
            <strong>{formatMoney(totalCents)}</strong>
          </div>
          {paid.map((ticket) => (
            <div className="production-row" key={ticket.id}>
              <span>{ticket.ticketNumber}</span>
              <strong>{formatBusinessDateTime(ticket.createdAtUtc)}</strong>
              <span>{ticket.items.map((item) => `${item.quantity} ${item.productName}`).join(", ")}</span>
              <span>{paymentLabels[ticket.paymentMethod]}</span>
              <strong>{formatMoney(ticket.totalCents)}</strong>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
