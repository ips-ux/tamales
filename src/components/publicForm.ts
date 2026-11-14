// Pure helpers for the public pages: text splitting, display formats, and
// form validation. No React and no browser APIs, so tests can import them.

export const CONTACT_MESSAGE_MAX = 2000;

/** Splits owner text into paragraphs. A blank line starts a new paragraph. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** "7203608688", "(720) 360-8688" and "+1 720 360 8688" all become "720-360-8688". */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value.trim();
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

/** The value for a `tel:` link. */
export function phoneHref(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits}`;
}

/** V1_DESIGN section 5: "6 (half dozen)", "12 (1 dozen)", "24 (2 dozen)", "5 tamales". The Worker uses the same rule. */
export { quantityLabel } from "../../shared/quantity";

/** The first word of a full name, for "Thanks, Jane!". */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export interface ContactFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
}

/** Trims each field. Send this result, not the raw input. */
export function cleanContactFields(fields: ContactFields): ContactFields {
  return {
    firstName: fields.firstName.trim(),
    lastName: fields.lastName.trim(),
    email: fields.email.trim(),
    phone: fields.phone.trim(),
    message: fields.message.trim()
  };
}

/** Returns 1 instruction for each problem. An empty list means the form is correct. */
export function validateContact(fields: ContactFields): string[] {
  const clean = cleanContactFields(fields);
  const errors: string[] = [];
  if (!clean.firstName) errors.push("Enter your first name.");
  if (!clean.lastName) errors.push("Enter your last name.");
  if (!clean.email) errors.push("Enter your email address.");
  else if (!isEmail(clean.email)) errors.push("Enter a complete email address.");
  if (clean.phone && clean.phone.replace(/\D/g, "").length < 10) {
    errors.push("Enter a phone number with 10 digits, or leave the phone field empty.");
  }
  if (!clean.message) errors.push("Enter your message.");
  else if (clean.message.length > CONTACT_MESSAGE_MAX) {
    errors.push("Make your message 2,000 characters or shorter.");
  }
  return errors;
}

/** Returns an instruction, or an empty string when the address is correct. */
export function validateSignupEmail(email: string): string {
  const clean = email.trim();
  if (!clean) return "Enter your email address.";
  if (!isEmail(clean)) return "Enter a complete email address.";
  return "";
}
