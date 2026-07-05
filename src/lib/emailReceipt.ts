// Outbound receipt email via EmailJS (https://www.emailjs.com). EmailJS is the
// one mainstream sender designed for browser-side use — the public key is safe
// to ship, restrictable to this site's origin in the EmailJS dashboard — and
// its free tier (200 emails/month) fits the no-backend Spark plan. When the
// VITE_EMAILJS_* values are absent, the receipt drawer still collects emails
// for the marketing list; it just tells the operator no email went out.
//
// The receipt body is built here as a self-contained, table-based HTML fragment
// with inline styles (no <style> blocks, no flexbox/grid — those are stripped or
// unsupported by Gmail/Outlook/Apple Mail). The layout is fluid (width:100% up
// to a max width), so it reflows cleanly on phones without media queries. It is
// sent as one `receipt_html` variable, so the EmailJS template body is just
// `{{{receipt_html}}}` (triple braces = unescaped) and the visual designer is
// bypassed entirely.

const config = {
  serviceId: import.meta.env.VITE_EMAILJS_SERVICE_ID as string | undefined,
  templateId: import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string | undefined,
  publicKey: import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string | undefined
};

export function receiptEmailConfigured(): boolean {
  return Boolean(config.serviceId && config.templateId && config.publicKey);
}

export interface ReceiptEmailItem {
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

export interface ReceiptEmailInput {
  toEmail: string;
  businessName: string;
  ticketNumber: string;
  purchasedAt: string;
  items: ReceiptEmailItem[];
  subtotal: string;
  tax: string;
  total: string;
  paymentMethod: string;
  /** Name the order is for; rendered under the header when present. */
  customerName?: string;
  /** Header label; defaults to "Receipt" (pre-orders use "Order Request"). */
  heading?: string;
  /** Footer message; defaults to the thank-you/keep-this-receipt line. */
  footerNote?: string;
  /**
   * Second-chance marketing CTA. Set only when the customer did NOT opt in at
   * checkout; the receipt then ends with a "sign me up" button to this URL.
   */
  signupUrl?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const INK = "#171311";
const CREAM = "#fff7ea";
const CREAM_SHELL = "#f4e7d2";
const RED = "#c92822";
const MASA = "#e4b044";
const MUTED = "#6d5d51";
const LINE = "#e8e0d3";

export function buildReceiptHtml(input: ReceiptEmailInput): string {
  const business = escapeHtml(input.businessName);

  const itemRows = input.items
    .map(
      (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};">
          <span style="display:block;font-size:15px;font-weight:bold;color:${INK};">${escapeHtml(item.name)}</span>
          <span style="display:block;font-size:13px;color:${MUTED};">Qty ${item.quantity} &times; ${escapeHtml(item.unitPrice)}</span>
        </td>
        <td align="right" valign="top" style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:15px;font-weight:bold;color:${INK};white-space:nowrap;">${escapeHtml(item.lineTotal)}</td>
      </tr>`
    )
    .join("");

  const totalRow = (label: string, value: string, options: { strong?: boolean; top?: boolean } = {}) => {
    const size = options.strong ? "17px" : "14px";
    const weight = options.strong ? "bold" : "normal";
    const labelColor = options.strong ? INK : MUTED;
    const valueColor = options.strong ? RED : INK;
    const border = options.top ? `border-top:2px solid ${INK};` : "";
    const pad = options.strong ? "12px 0" : "5px 0";
    return `
      <tr>
        <td style="padding:${pad};font-size:${size};font-weight:${weight};color:${labelColor};${border}">${label}</td>
        <td align="right" style="padding:${pad};font-size:${size};font-weight:${weight};color:${valueColor};${border}white-space:nowrap;">${escapeHtml(value)}</td>
      </tr>`;
  };

  // Outer table paints the shell background; inner table (max-width 520) is the
  // centered receipt card. width:100% keeps it fluid on small screens.
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:24px 12px;background:${CREAM_SHELL};">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:${CREAM};border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="height:6px;background:${MASA};line-height:6px;font-size:6px;">&nbsp;</td></tr>
        <tr>
          <td style="padding:24px 22px 6px;">
            <div style="font-size:22px;font-weight:bold;color:${INK};">${business} <span style="color:${RED};">${escapeHtml(input.heading ?? "Receipt")}</span></div>
            ${
              input.customerName
                ? `<div style="font-size:14px;font-weight:bold;color:${INK};padding-top:6px;">Order for ${escapeHtml(input.customerName)}</div>`
                : ""
            }
            <div style="font-size:13px;color:${MUTED};padding-top:4px;">Order time: ${escapeHtml(input.purchasedAt)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 22px 0;">
            <div style="font-size:15px;font-weight:bold;color:${INK};border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};padding:12px 0;">Ticket #${escapeHtml(input.ticketNumber)}</div>
          </td>
        </tr>
        <tr>
          <td style="padding:4px 22px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 22px 4px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${totalRow("Subtotal", input.subtotal)}
              ${totalRow("Taxes", input.tax)}
              ${totalRow("Order Total", input.total, { strong: true, top: true })}
              ${totalRow("Payment", input.paymentMethod)}
            </table>
          </td>
        </tr>
        ${
          input.signupUrl
            ? `
        <tr>
          <td style="padding:20px 22px;background:${CREAM_SHELL};text-align:center;">
            <div style="font-size:16px;font-weight:bold;color:${INK};text-transform:uppercase;">Want first dibs on the next batch?</div>
            <div style="font-size:13px;color:${MUTED};padding:6px 8px 14px;line-height:1.5;">Pop-up dates, preorder windows, and specials &mdash; straight to your inbox. Zero spam, all tamales.</div>
            <a href="${escapeHtml(input.signupUrl)}" style="display:inline-block;padding:12px 28px;background:${RED};color:${CREAM};font-size:14px;font-weight:bold;text-decoration:none;text-transform:uppercase;border-radius:999px;">Sign Me Up</a>
          </td>
        </tr>`
            : ""
        }
        <tr>
          <td style="margin-top:12px;padding:20px 22px;background:${INK};color:${CREAM};text-align:center;font-size:12px;line-height:1.6;">
            ${
              input.footerNote
                ? escapeHtml(input.footerNote)
                : `Thank you for supporting ${business}!<br />Keep this receipt for your records.`
            }
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

export async function sendReceiptEmail(input: ReceiptEmailInput): Promise<void> {
  if (!receiptEmailConfigured()) {
    throw new Error("Receipt email is not configured. Add VITE_EMAILJS values to .env.local.");
  }
  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: config.serviceId,
      template_id: config.templateId,
      user_id: config.publicKey,
      template_params: {
        to_email: input.toEmail,
        business_name: input.businessName,
        ticket_number: input.ticketNumber,
        receipt_html: buildReceiptHtml(input)
      }
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Email service error (${response.status}): ${detail || "unknown"}`);
  }
}
