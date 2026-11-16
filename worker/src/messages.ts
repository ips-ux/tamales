// Email content: the POS receipt, the contact message alert, and the order emails.
// Rules: docs/V1_DESIGN.md sections 4, 5 and 10.

import type { OutgoingEmail } from "./email";
import type { EmailContent, EmailItem, EmailRow } from "./emailHtml";
import type { Config } from "./env";
import { formatDateKey, formatDateTime, formatMoney } from "./format";
import type { ContactInput } from "./validate";
import type { OrderRecord } from "../../shared/model";
import { quantityLabel } from "../../shared/quantity";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Cash",
  cashapp: "Cash App",
  paypal: "PayPal",
  venmo: "Venmo",
  zelle: "Zelle",
  applepay: "Apple Pay"
};

export interface ReceiptOptions {
  toEmail: string;
  includeSignupLink: boolean;
  timeZone: string;
}

/** Builds the POS receipt from a `posTickets` document. */
export function buildReceiptEmail(
  ticket: Record<string, unknown>,
  options: ReceiptOptions,
  cfg: Pick<Config, "ownerEmail" | "siteOrigin">
): OutgoingEmail {
  const number = String(ticket.ticketNumber ?? "");
  const items = Array.isArray(ticket.items) ? (ticket.items as Record<string, unknown>[]) : [];
  const customerName = String(ticket.customerName ?? "").trim();
  const method = String(ticket.paymentMethod ?? "");
  const details = [
    { label: "Order number", value: number },
    { label: "Order time", value: formatDateTime(String(ticket.createdAtUtc ?? ""), options.timeZone) }
  ];
  if (customerName) details.push({ label: "Name", value: customerName });

  return {
    to: options.toEmail,
    replyTo: cfg.ownerEmail,
    subject: `Your receipt: ${number}`,
    content: {
      heading: "Receipt",
      lines: ["Thank you for your order!", "Keep this receipt for your records."],
      details,
      items: items.map((item) => {
        const quantity = Number(item.quantity ?? 0);
        const unit = Number(item.unitPriceCents ?? 0);
        return {
          name: String(item.productName ?? ""),
          detail: `Quantity ${quantity} x ${formatMoney(unit)}`,
          total: formatMoney(quantity * unit)
        };
      }),
      totals: [
        { label: "Subtotal", value: formatMoney(Number(ticket.subtotalCents ?? 0)) },
        { label: "Tax", value: formatMoney(Number(ticket.taxCents ?? 0)) },
        { label: "Total", value: formatMoney(Number(ticket.totalCents ?? 0)), strong: true },
        { label: "Payment", value: PAYMENT_LABELS[method] ?? method }
      ],
      button: options.includeSignupLink
        ? {
            title: "Get the next pop-up date first.",
            text: "The email list gets pop-up dates and pre-order openings.",
            label: "Join the Email List",
            url: `${cfg.siteOrigin}/updates?email=${encodeURIComponent(options.toEmail)}`
          }
        : undefined,
      contactEmail: cfg.ownerEmail
    }
  };
}

/** Builds the alert that tells the owner about a contact message. */
export function buildContactEmail(
  input: ContactInput,
  createdAtUtc: string,
  timeZone: string,
  cfg: Pick<Config, "ownerEmail" | "siteOrigin">
): OutgoingEmail {
  const name = `${input.firstName} ${input.lastName}`;
  const details = [
    { label: "Name", value: name },
    { label: "Email", value: input.email }
  ];
  if (input.phone) details.push({ label: "Phone", value: input.phone });
  details.push({ label: "Sent", value: formatDateTime(createdAtUtc, timeZone) });
  return {
    to: cfg.ownerEmail,
    replyTo: input.email,
    subject: `New contact message: ${name}`,
    content: {
      heading: "Contact message",
      lines: [`${name} sent a message from the website.`, "Reply to this email to answer the customer."],
      details,
      note: { label: "Message", text: input.message },
      button: { label: "Open Admin", url: `${cfg.siteOrigin}/admin` },
      contactEmail: cfg.ownerEmail
    }
  };
}

// ---------------------------------------------------------------------------
// Order emails (build piece 2).
// ---------------------------------------------------------------------------

type MailConfig = Pick<Config, "ownerEmail" | "siteOrigin">;

const METHOD_LABELS: Record<string, string> = { venmo: "Venmo", cashapp: "Cash App", cash: "Cash", paypal: "PayPal" };
const KIND_LABELS: Record<OrderRecord["kind"], string> = {
  live: "Order",
  preorder: "Pre-order",
  batch: "Batch request"
};

function orderItems(order: OrderRecord): EmailItem[] {
  return order.items.map((line) => ({
    name: `${line.itemName}, ${line.variantLabel}`,
    detail:
      line.unitTamales > 1
        ? `Quantity: ${quantityLabel(line.unitTamales * line.quantity)}`
        : `Quantity ${line.quantity} x ${formatMoney(line.unitPriceCents)}`,
    total: formatMoney(line.lineTotalCents)
  }));
}

function orderTotals(order: OrderRecord): EmailRow[] {
  const rows: EmailRow[] = [{ label: "Subtotal", value: formatMoney(order.totals.subtotalCents) }];
  if (order.delivery) {
    const toBeSet = order.delivery.feeStatus === "to_be_set";
    rows.push({ label: "Delivery fee", value: toBeSet ? "We set it at approval" : formatMoney(order.totals.deliveryFeeCents) });
  }
  if (order.totals.onlineFeeCents > 0) {
    rows.push({ label: "Online ordering fee", value: formatMoney(order.totals.onlineFeeCents) });
  }
  rows.push({ label: "Tax", value: formatMoney(order.totals.taxCents) });
  rows.push({ label: "Total", value: formatMoney(order.totals.totalCents), strong: true });
  return rows;
}

/** Order number, event or batch data. The only street address is the delivery address of the customer. */
function orderDetails(order: OrderRecord, timeZone: string): EmailRow[] {
  const rows: EmailRow[] = [{ label: "Order number", value: order.orderNumber }];
  if (order.eventName) rows.push({ label: "Event", value: order.eventName });
  if (order.kind === "batch") {
    rows.push({ label: "Order type", value: order.fulfillment === "delivery" ? "Delivery" : "Pickup" });
  }
  if (order.scheduledAtUtc) {
    rows.push({ label: "Date and time", value: formatDateTime(order.scheduledAtUtc, timeZone) });
  } else if (order.requested) {
    const when = [formatDateKey(order.requested.date), order.requested.timeRange].filter(Boolean).join(", ");
    rows.push({ label: "Requested date", value: when });
  }
  if (order.delivery) rows.push({ label: "Delivery address", value: order.delivery.address });
  return rows;
}

function trackerButton(order: OrderRecord, cfg: MailConfig): EmailContent["button"] {
  return { label: "Open Order Tracker", url: `${cfg.siteOrigin}/t/${order.trackerToken}` };
}

/** The customer pays on the order tracker. */
function payButton(order: OrderRecord, cfg: MailConfig): EmailContent["button"] {
  return { label: "Pay Now", url: `${cfg.siteOrigin}/t/${order.trackerToken}` };
}

function customerEmail(
  order: OrderRecord,
  subject: string,
  content: Omit<EmailContent, "contactEmail">,
  cfg: MailConfig
): OutgoingEmail {
  return {
    to: order.customer.email,
    replyTo: cfg.ownerEmail,
    subject: `${subject}: ${order.orderNumber}`,
    content: { ...content, contactEmail: cfg.ownerEmail }
  };
}

/** "We have your order", for all 3 kinds. A requested order waits for approval. */
export function buildOrderReceivedEmail(order: OrderRecord, timeZone: string, cfg: MailConfig): OutgoingEmail {
  const details = orderDetails(order, timeZone);
  if (order.kind === "live") {
    details.push({ label: "Payment", value: METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod });
    if (order.paymentMethod === "venmo" || order.paymentMethod === "cashapp") {
      details.push({ label: "Payment description", value: order.paymentDescription });
    }
  }
  // A live order with PayPal Checkout is paid on the order tracker.
  const payNow = order.kind === "live" && order.paymentMethod === "paypal" && order.paymentState === "unpaid";
  const next =
    order.state === "requested"
      ? "We approve each order before it is final. Wait for our email."
      : payNow
        ? "Open the order tracker to pay for your order."
        : "Open the order tracker to see the status of your order.";
  return customerEmail(
    order,
    "We received your order",
    {
      heading: "Order",
      lines: [`Thanks, ${order.customer.firstName}! We have your order.`, next],
      details,
      items: orderItems(order),
      totals: orderTotals(order),
      button: payNow ? payButton(order, cfg) : trackerButton(order, cfg)
    },
    cfg
  );
}

/** A fixed-allotment pre-order: the tamales are held while the customer pays. */
export function buildOrderHoldEmail(
  order: OrderRecord,
  holdMinutes: number,
  timeZone: string,
  cfg: MailConfig
): OutgoingEmail {
  const details = orderDetails(order, timeZone);
  if (order.payByUtc) details.push({ label: "Pay by", value: formatDateTime(order.payByUtc, timeZone) });
  return customerEmail(
    order,
    "We received your order",
    {
      heading: "Order",
      lines: [
        `Thanks, ${order.customer.firstName}! We hold your tamales for ${holdMinutes} minutes.`,
        "Pay now to keep your order."
      ],
      details,
      items: orderItems(order),
      totals: orderTotals(order),
      button: payButton(order, cfg)
    },
    cfg
  );
}

/** The alert to the owner for an order that waits for approval. */
export function buildOrderAlertEmail(order: OrderRecord, timeZone: string, cfg: MailConfig): OutgoingEmail {
  const name = `${order.customer.firstName} ${order.customer.lastName}`;
  const details: EmailRow[] = [
    ...orderDetails(order, timeZone),
    { label: "Type", value: KIND_LABELS[order.kind] },
    { label: "Customer", value: name },
    { label: "Email", value: order.customer.email }
  ];
  if (order.customer.phone) details.push({ label: "Phone", value: order.customer.phone });
  if (order.delivery) {
    const miles = order.delivery.distanceMiles;
    details.push({ label: "Distance", value: miles === null ? "Address not found" : `${miles} miles` });
  }
  if (order.ownerNote) details.push({ label: "Note", value: order.ownerNote });
  return {
    to: cfg.ownerEmail,
    replyTo: order.customer.email,
    subject: `New order to approve: ${order.orderNumber}`,
    content: {
      heading: "New order",
      lines: [`${name} sent a ${KIND_LABELS[order.kind].toLowerCase()}.`, "Open Admin to approve or decline it."],
      details,
      note: order.customerNote ? { label: "Customer note", text: order.customerNote } : undefined,
      items: orderItems(order),
      totals: orderTotals(order),
      button: { label: "Open Pre-Orders", url: `${cfg.siteOrigin}/admin/preorders` },
      contactEmail: cfg.ownerEmail
    }
  };
}

/** "Approved, pay now". It gives the final total, the time limit and the Pay Now button. */
export function buildOrderApprovedEmail(order: OrderRecord, timeZone: string, cfg: MailConfig): OutgoingEmail {
  const payBy = order.payByUtc ? formatDateTime(order.payByUtc, timeZone) : "";
  const details = orderDetails(order, timeZone);
  if (payBy) details.push({ label: "Pay by", value: payBy });
  return customerEmail(
    order,
    "We approved your order",
    {
      heading: "Order approved",
      lines: [
        `Good news, ${order.customer.firstName}! We approved your order.`,
        payBy ? `Pay by ${payBy} to confirm it.` : "Pay now to confirm it."
      ],
      details,
      items: orderItems(order),
      totals: orderTotals(order),
      button: payButton(order, cfg)
    },
    cfg
  );
}

/** The time to pay ended. The Worker sends it from the scheduled run. */
export function buildOrderExpiredEmail(order: OrderRecord, timeZone: string, cfg: MailConfig): OutgoingEmail {
  return customerEmail(
    order,
    "Your order expired",
    {
      heading: "Order expired",
      lines: ["We did not receive the payment in time.", "Send a new order if you still want tamales."],
      details: orderDetails(order, timeZone),
      button: { label: "Order Tamales", url: `${cfg.siteOrigin}/order` }
    },
    cfg
  );
}

/** The owner recorded a refund. The owner sent the money before that. */
export function buildOrderRefundEmail(
  order: OrderRecord,
  refund: { amountCents: number; reason: string; canceled: boolean },
  timeZone: string,
  cfg: MailConfig
): OutgoingEmail {
  const details = orderDetails(order, timeZone);
  details.push({ label: "Refund", value: formatMoney(refund.amountCents) });
  return customerEmail(
    order,
    "We sent your refund",
    {
      heading: "Refund",
      lines: [
        refund.canceled
          ? `We canceled this order and sent your refund of ${formatMoney(refund.amountCents)}.`
          : `We sent your refund of ${formatMoney(refund.amountCents)}.`,
        "The money can take some days to show in your account."
      ],
      details,
      note: refund.reason ? { label: "Reason", text: refund.reason } : undefined
    },
    cfg
  );
}

/** An alert to the owner about a PayPal payment that needs a decision. */
export function buildPaymentAlertEmail(
  order: OrderRecord,
  alert: { subject: string; lines: string[]; captureId: string; amountCents: number | null },
  timeZone: string,
  cfg: MailConfig
): OutgoingEmail {
  const details: EmailRow[] = [
    ...orderDetails(order, timeZone),
    { label: "Customer", value: `${order.customer.firstName} ${order.customer.lastName}` },
    { label: "Email", value: order.customer.email },
    { label: "Order total", value: formatMoney(order.totals.totalCents) }
  ];
  if (alert.amountCents !== null) details.push({ label: "PayPal took", value: formatMoney(alert.amountCents) });
  if (alert.captureId) details.push({ label: "PayPal transaction", value: alert.captureId });
  return {
    to: cfg.ownerEmail,
    replyTo: order.customer.email,
    subject: `${alert.subject}: ${order.orderNumber}`,
    content: {
      heading: "Payment alert",
      lines: alert.lines,
      details,
      button: { label: "Open Admin", url: `${cfg.siteOrigin}/admin` },
      contactEmail: cfg.ownerEmail
    }
  };
}

/** "Declined" or "canceled", with the reason of the owner. */
export function buildOrderStoppedEmail(
  order: OrderRecord,
  action: "decline" | "cancel",
  timeZone: string,
  cfg: MailConfig
): OutgoingEmail {
  const declined = action === "decline";
  return customerEmail(
    order,
    declined ? "We declined your order" : "We canceled your order",
    {
      heading: declined ? "Order declined" : "Order canceled",
      lines: [
        declined ? "We cannot make this order." : "We canceled this order.",
        "Reply to this email if you have a question."
      ],
      details: orderDetails(order, timeZone),
      note: order.reason ? { label: "Reason", text: order.reason } : undefined
    },
    cfg
  );
}

export function buildOrderReadyEmail(order: OrderRecord, timeZone: string, cfg: MailConfig): OutgoingEmail {
  const next: Record<OrderRecord["fulfillment"], string> = {
    event_pickup: "Come to the booth and show the order tracker.",
    pickup: "Come to the pickup address and show the order tracker.",
    delivery: "We will bring it to you soon."
  };
  return customerEmail(
    order,
    "Your order is ready",
    {
      heading: "Order ready",
      lines: [`Your order is ready, ${order.customer.firstName}!`, next[order.fulfillment] ?? next.event_pickup],
      details: orderDetails(order, timeZone),
      button: trackerButton(order, cfg)
    },
    cfg
  );
}

/** The exact pickup place. Only the payment receipt shows it. */
export interface PickupPlace {
  address: string;
  instructions: string;
  /** For example "Sat, Nov 14, 5:00 PM - 8:00 PM MT". Empty if there is none. */
  time: string;
}

/** The payment receipt. It is the only email with the exact pickup address. */
export function buildOrderPaidEmail(
  order: OrderRecord,
  pickup: PickupPlace | null,
  timeZone: string,
  cfg: MailConfig
): OutgoingEmail {
  const details = orderDetails(order, timeZone);
  if (pickup?.time) details.push({ label: "Pickup time", value: pickup.time });
  if (pickup?.address) details.push({ label: "Pickup address", value: pickup.address });
  if (pickup?.instructions) details.push({ label: "Pickup instructions", value: pickup.instructions });
  return customerEmail(
    order,
    "We received your payment",
    {
      heading: "Receipt",
      lines: [`Thanks, ${order.customer.firstName}! We received your payment.`, "Keep this receipt for your records."],
      details,
      items: orderItems(order),
      totals: orderTotals(order),
      button: trackerButton(order, cfg)
    },
    cfg
  );
}
