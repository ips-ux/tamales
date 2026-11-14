// Email content for the POS receipt and the contact message alert.

import type { OutgoingEmail } from "./email";
import type { Config } from "./env";
import { formatDateTime, formatMoney } from "./format";
import type { ContactInput } from "./validate";

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
