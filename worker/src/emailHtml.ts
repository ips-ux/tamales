// One HTML builder for all email. Rules: docs/V1_DESIGN.md section 10.
// Table layout, inline styles, no <style> block, no media query. All text is escaped here.

import { BUSINESS_NAME } from "./env";

const INK = "#171311";
const CREAM = "#fff7ea";
const CREAM_SHELL = "#f4e7d2";
const RED = "#c92822";
const MASA = "#e4b044";
const MUTED = "#6d5d51";
const LINE = "#e8e0d3";

export interface EmailItem {
  name: string;
  /** Second line, for example "Quantity 2 x $34.00". */
  detail: string;
  total: string;
}

export interface EmailRow {
  label: string;
  value: string;
  /** True makes the row the large "Total" row. */
  strong?: boolean;
}

export interface EmailContent {
  /** Shown in red after the business name: "Receipt", "Order", "Contact message". */
  heading: string;
  /** Line 1 says what occurred. Line 2 says what the reader does next. */
  lines: string[];
  /** Label and value pairs: order number, date, customer data. */
  details?: EmailRow[];
  /** A block of customer text that can have line breaks. */
  note?: { label: string; text: string };
  items?: EmailItem[];
  totals?: EmailRow[];
  /** The 1 action. `title` and `text` show above the button on the shell color. */
  button?: { title?: string; text?: string; label: string; url: string };
  /** Contact email address for the footer. */
  contactEmail: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function multiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

function row(item: EmailRow, isFirstStrong: boolean): string {
  const size = item.strong ? "17px" : "14px";
  const weight = item.strong ? "bold" : "normal";
  const labelColor = item.strong ? INK : MUTED;
  const valueColor = item.strong ? RED : INK;
  const border = item.strong && isFirstStrong ? `border-top:2px solid ${INK};` : "";
  const pad = item.strong ? "12px 0" : "5px 0";
  return `
      <tr>
        <td valign="top" style="padding:${pad};padding-right:12px;font-size:${size};font-weight:${weight};color:${labelColor};${border}">${escapeHtml(item.label)}</td>
        <td align="right" valign="top" style="padding:${pad};font-size:${size};font-weight:${weight};color:${valueColor};${border}">${escapeHtml(item.value)}</td>
      </tr>`;
}

function rows(items: EmailRow[]): string {
  const firstStrong = items.findIndex((item) => item.strong);
  return items.map((item, index) => row(item, index === firstStrong)).join("");
}

function section(inner: string, padding = "8px 22px 4px"): string {
  return `
        <tr>
          <td style="padding:${padding};">${inner}</td>
        </tr>`;
}

const TABLE = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"`;

export function buildEmailHtml(content: EmailContent): string {
  const lines = content.lines
    .map(
      (line, index) =>
        `<div style="font-size:15px;line-height:1.5;color:${INK};padding-top:${index === 0 ? "10px" : "4px"};">${escapeHtml(line)}</div>`
    )
    .join("");

  const details = content.details?.length
    ? section(
        `${TABLE} style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};">${rows(content.details)}</table>`,
        "12px 22px 0"
      )
    : "";

  const note = content.note
    ? section(
        `<div style="font-size:13px;color:${MUTED};">${escapeHtml(content.note.label)}</div>
            <div style="font-size:15px;line-height:1.5;color:${INK};padding-top:4px;">${multiline(content.note.text)}</div>`,
        "14px 22px 4px"
      )
    : "";

  const items = content.items?.length
    ? section(
        `${TABLE}>${content.items
          .map(
            (item) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid ${LINE};">
          <span style="display:block;font-size:15px;font-weight:bold;color:${INK};">${escapeHtml(item.name)}</span>
          <span style="display:block;font-size:13px;color:${MUTED};">${escapeHtml(item.detail)}</span>
        </td>
        <td align="right" valign="top" style="padding:10px 0;border-bottom:1px solid ${LINE};font-size:15px;font-weight:bold;color:${INK};white-space:nowrap;">${escapeHtml(item.total)}</td>
      </tr>`
          )
          .join("")}</table>`,
        "4px 22px"
      )
    : "";

  const totals = content.totals?.length ? section(`${TABLE}>${rows(content.totals)}</table>`) : "";

  const button = content.button
    ? `
        <tr>
          <td style="padding:20px 22px;background:${CREAM_SHELL};text-align:center;">
            ${content.button.title ? `<div style="font-size:16px;font-weight:bold;color:${INK};">${escapeHtml(content.button.title)}</div>` : ""}
            ${content.button.text ? `<div style="font-size:13px;color:${MUTED};padding:6px 8px 14px;line-height:1.5;">${escapeHtml(content.button.text)}</div>` : ""}
            <a href="${escapeHtml(content.button.url)}" style="display:inline-block;padding:12px 28px;background:${RED};color:${CREAM};font-size:14px;font-weight:bold;text-decoration:none;border-radius:999px;">${escapeHtml(content.button.label)}</a>
          </td>
        </tr>`
    : "";

  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0;padding:24px 12px;background:${CREAM_SHELL};">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:${CREAM};border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
        <tr><td style="height:6px;background:${MASA};line-height:6px;font-size:6px;">&nbsp;</td></tr>
        <tr>
          <td style="padding:24px 22px 6px;">
            <div style="font-size:22px;font-weight:bold;color:${INK};">${escapeHtml(BUSINESS_NAME)} <span style="color:${RED};">${escapeHtml(content.heading)}</span></div>
            ${lines}
          </td>
        </tr>${details}${note}${items}${totals}
        <tr><td style="height:16px;line-height:16px;font-size:16px;">&nbsp;</td></tr>${button}
        <tr>
          <td style="padding:20px 22px;background:${INK};color:${CREAM};text-align:center;font-size:12px;line-height:1.6;">
            ${escapeHtml(BUSINESS_NAME)}<br />${escapeHtml(content.contactEmail)}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`.trim();
}

/** Plain-text version of the same content, for mail clients that do not show HTML. */
export function buildEmailText(content: EmailContent): string {
  const out: string[] = [`${BUSINESS_NAME} ${content.heading}`, "", ...content.lines];
  if (content.details?.length) {
    out.push("", ...content.details.map((item) => `${item.label}: ${item.value}`));
  }
  if (content.note) out.push("", `${content.note.label}:`, content.note.text);
  if (content.items?.length) {
    out.push("", ...content.items.map((item) => `${item.name}, ${item.detail}: ${item.total}`));
  }
  if (content.totals?.length) {
    out.push("", ...content.totals.map((item) => `${item.label}: ${item.value}`));
  }
  if (content.button) {
    out.push("");
    if (content.button.title) out.push(content.button.title);
    out.push(`${content.button.label}: ${content.button.url}`);
  }
  out.push("", BUSINESS_NAME, content.contactEmail);
  return out.join("\n");
}
