import {
  CalendarDays,
  ClipboardCheck,
  CreditCard,
  Download,
  Eye,
  FileText,
  ListChecks,
  Package,
  Plus,
  QrCode,
  Search,
  Settings,
  Trash2,
  Users
} from "lucide-react";
import { Dispatch, FormEvent, SetStateAction, useEffect, useMemo, useState } from "react";
import { QRCodePanel } from "../components/QRCodePanel";
import {
  availabilityWindows,
  businessSettings,
  contactSubmissions,
  menuProducts,
  paymentSettings as initialPaymentSettings,
  pickupLocations,
  sampleOrders,
  vendorSessions
} from "../data/fixtures";
import { downloadCsv } from "../lib/csv";
import {
  savePosTicket,
  watchPosTickets,
  type PosPaymentMethod,
  type PosTicketRecord
} from "../lib/firestoreClient";
import { formatMoney } from "../lib/money";
import { canTransitionOrder } from "../lib/order";
import { denverDateKey, denverTodayKey, formatDenverDateTime, formatWindow } from "../lib/time";
import type {
  MenuProduct,
  OrderRecord,
  OrderStatus,
  PaymentSettings,
  PosTicketItem
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

export function AdminPage({ path }: AdminPageProps) {
  const [orders, setOrders] = useState<OrderRecord[]>(sampleOrders);
  const [products, setProducts] = useState<MenuProduct[]>(menuProducts);
  const [payments, setPayments] = useState<PaymentSettings>(initialPaymentSettings);
  const [query, setQuery] = useState("");
  const pos = usePosTickets();
  const title = adminTitle(path);

  const filteredOrders = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return orders;
    return orders.filter(
      (order) =>
        order.orderNumber.toLowerCase().includes(normalized) ||
        order.customer.name.toLowerCase().includes(normalized) ||
        order.customer.mobile.toLowerCase().includes(normalized)
    );
  }, [orders, query]);

  function updateStatus(id: string, status: OrderStatus) {
    setOrders((current) =>
      current.map((order) =>
        order.id === id && canTransitionOrder(order.status, status)
          ? { ...order, status, updatedAtUtc: new Date().toISOString() }
          : order
      )
    );
  }

  return (
    <main className="admin-shell">
      <section className="admin-heading">
        <p className="eyebrow">Owner Area</p>
        <h1>{title}</h1>
        <p>Firebase Auth admin claims protect these routes in production.</p>
      </section>

      {title === "Dashboard" && <Dashboard pos={pos} products={products} />}
      {title === "Live POS" && <PosView products={products} payments={payments} />}
      {title === "Orders" && (
        <OrdersView
          orders={filteredOrders}
          query={query}
          setQuery={setQuery}
          updateStatus={updateStatus}
        />
      )}
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
  const todayKey = denverTodayKey();
  const paidToday = pos.tickets.filter(
    (ticket) => ticket.status === "paid" && denverDateKey(ticket.createdAtUtc) === todayKey
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
                <span>{formatDenverDateTime(ticket.createdAtUtc)}</span>
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

function PosView({ products, payments }: { products: MenuProduct[]; payments: PaymentSettings }) {
  const [items, setItems] = useState<PosTicketItem[]>([]);
  const [checkout, setCheckout] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const activeProducts = products.filter((product) => product.status === "active");
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const taxCents = Math.round((subtotalCents * businessSettings.taxRateBps) / 10000);
  const totalCents = subtotalCents + taxCents;

  function addProduct(product: MenuProduct) {
    const variant = product.variants[0];
    if (!variant) return;
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
          unitPriceCents: variant.priceCents
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
    setMethod("cash");
    setSaveError(null);
  }

  async function handleMarkPaid() {
    if (items.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await savePosTicket({ items, subtotalCents, taxCents, totalCents, paymentMethod: method });
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
        {activeProducts.map((product) => (
          <button className="pos-product-button" key={product.id} type="button" onClick={() => addProduct(product)}>
            <span>{product.name}</span>
            <strong>{formatMoney(product.variants[0]?.priceCents ?? 0)}</strong>
          </button>
        ))}
      </div>

      <aside className="pos-ticket" aria-label="Current ticket">
        <div className="pos-ticket-header">
          <div>
            <p className="eyebrow">Live Ticket</p>
            <h2>{formatMoney(totalCents)}</h2>
          </div>
          <button className="button button-small" type="button" onClick={clearTicket} disabled={items.length === 0}>
            Clear
          </button>
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
    </section>
  );
}

function OrdersView({
  orders,
  query,
  setQuery,
  updateStatus
}: {
  orders: OrderRecord[];
  query: string;
  setQuery: (value: string) => void;
  updateStatus: (id: string, status: OrderStatus) => void;
}) {
  return (
    <section className="admin-card">
      <div className="toolbar">
        <label className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search orders"
          />
        </label>
        <button className="button button-ghost" type="button">
          <Download size={18} />
          Export
        </button>
      </div>
      <div className="order-admin-list">
        {orders.map((order) => (
          <article className="order-admin-card" key={order.id}>
            <div>
              <p className="eyebrow">{order.orderNumber}</p>
              <h2>{order.customer.name}</h2>
              <p>{order.customer.mobile} / {order.customer.preferredContact}</p>
            </div>
            <div>
              <span className={`status-badge status-${order.status}`}>{statusLabels[order.status]}</span>
              <strong>{formatMoney(order.totals.totalCents)}</strong>
            </div>
            <div className="order-items-mini">
              {order.items.map((item) => (
                <span key={item.variantId}>
                  {item.quantity} x {item.productName} {item.variantLabel}
                </span>
              ))}
            </div>
            <div className="button-row">
              {(["confirmed", "preparing", "ready", "completed", "canceled"] as OrderStatus[]).map(
                (status) => (
                  <button
                    key={status}
                    type="button"
                    className="button button-small"
                    disabled={!canTransitionOrder(order.status, status)}
                    onClick={() => updateStatus(order.id, status)}
                  >
                    {statusLabels[status]}
                  </button>
                )
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MenuView({
  products,
  setProducts
}: {
  products: MenuProduct[];
  setProducts: Dispatch<SetStateAction<MenuProduct[]>>;
}) {
  function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const priceCents = Math.round(Number(form.get("price") ?? "0") * 100);
    if (!name || priceCents <= 0) return;
    const slug = slugify(name);
    const id = `custom-${slug}-${Date.now()}`;
    const product: MenuProduct = {
      id,
      name,
      slug,
      description: String(form.get("description") ?? "Single serving POS item."),
      ingredients: String(form.get("ingredients") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      spiceLevel: "mild",
      allergyNotice: "Ask staff for allergen details.",
      imageUrl: "/media/tamales_hero.png",
      status: "active",
      bulkMenuEnabled: form.get("bulkMenuEnabled") === "on",
      showWhenSoldOut: true,
      sortOrder: products.length + 1,
      variants: [
        {
          id: `${slug}-single`,
          productId: id,
          label: "Single serving",
          unitQuantity: 1,
          priceCents,
          minimumQuantity: 1,
          active: true,
          sortOrder: 1
        }
      ]
    };
    setProducts((current) => [...current, product]);
    event.currentTarget.reset();
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
      <form className="admin-card menu-form" onSubmit={addProduct}>
        <Plus size={24} />
        <h2>Add Menu Item</h2>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Ingredients
          <input name="ingredients" placeholder="masa, chile, pork" />
        </label>
        <label>
          Price
          <input name="price" type="number" min="0.01" step="0.01" inputMode="decimal" required />
        </label>
        <label>
          Short description
          <textarea name="description" rows={3} />
        </label>
        <label className="toggle-row">
          <input name="bulkMenuEnabled" type="checkbox" defaultChecked />
          <span>Add to bulk menu / website preorder menu</span>
        </label>
        <button className="button button-primary" type="submit">
          Add Item
        </button>
      </form>

      <div className="admin-grid">
        {products.map((product) => (
          <article className="admin-card" key={product.id}>
            <img className="admin-thumb" src={product.imageUrl} alt="" />
            <h2>{product.name}</h2>
            <p>{product.description}</p>
            <div className="admin-row">
              <span>Ingredients</span>
              <strong>{product.ingredients.join(", ") || "Not set"}</strong>
            </div>
            <div className="admin-row">
              <span>Single/POS price</span>
              <strong>{formatMoney(product.variants[0]?.priceCents ?? 0)}</strong>
            </div>
            <label className="toggle-row menu-toggle">
              <input
                type="checkbox"
                checked={product.bulkMenuEnabled}
                onChange={() => toggleBulk(product.id)}
              />
              <span>Show on preorder menu</span>
            </label>
            <button className="button button-small" type="button" onClick={() => removeProduct(product.id)}>
              <Trash2 size={16} />
              Remove
            </button>
          </article>
        ))}
      </div>
    </section>
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
          <small>{formatDenverDateTime(contact.createdAtUtc)}</small>
        </article>
      ))}
    </section>
  );
}

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
        <CreditCard size={24} />
        <h2>Business Settings</h2>
        <div className="admin-row">
          <span>Timezone</span>
          <strong>{businessSettings.timezone}</strong>
        </div>
        <div className="admin-row">
          <span>Tax rate</span>
          <strong>{businessSettings.taxRateBps / 100}%</strong>
        </div>
        <div className="admin-row">
          <span>Contact</span>
          <strong>{businessSettings.contactPhone}</strong>
        </div>
      </article>
    </section>
  );
}

function ExportsView({ pos }: { pos: PosState }) {
  const paid = pos.tickets.filter((ticket) => ticket.status === "paid");
  const totalCents = paid.reduce((sum, ticket) => sum + ticket.totalCents, 0);

  function exportCsv() {
    const header = ["Ticket", "Date (Denver)", "Payment", "Items", "Subtotal", "Tax", "Total"];
    const rows = paid.map((ticket) => [
      ticket.ticketNumber,
      formatDenverDateTime(ticket.createdAtUtc),
      paymentLabels[ticket.paymentMethod],
      ticket.items.map((item) => `${item.quantity}x ${item.productName}`).join("; "),
      (ticket.subtotalCents / 100).toFixed(2),
      (ticket.taxCents / 100).toFixed(2),
      (ticket.totalCents / 100).toFixed(2)
    ]);
    downloadCsv(`bbt-pos-sales-${denverTodayKey()}.csv`, [header, ...rows]);
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
              <strong>{formatDenverDateTime(ticket.createdAtUtc)}</strong>
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
