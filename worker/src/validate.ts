import { HttpError } from "./http";

const EMAIL_PATTERN = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const CONTROL_CHARS_KEEP_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/g;

export interface TextRule {
  /** Field name for the customer, in lower case: "first name". */
  label: string;
  max: number;
  required?: boolean;
  /** True keeps line breaks (message and notes fields). */
  multiline?: boolean;
}

/** Returns clean text. Throws a 400 with an instruction if the value is not valid. */
export function text(value: unknown, rule: TextRule): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") throw new HttpError(400, `Enter a valid ${rule.label}.`);
  const clean = rule.multiline
    ? value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS_KEEP_NEWLINE, " ").trim()
    : value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (rule.required && !clean) throw new HttpError(400, `Enter your ${rule.label}.`);
  if (clean.length > rule.max) {
    throw new HttpError(400, `Make your ${rule.label} shorter. The limit is ${rule.max} characters.`);
  }
  return clean;
}

export function isEmail(value: string): boolean {
  return value.length >= 5 && value.length <= 200 && EMAIL_PATTERN.test(value);
}

/** Returns the email address in lower case. */
export function email(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(400, "Enter your email address.");
  const clean = value.trim().toLowerCase();
  if (!isEmail(clean)) throw new HttpError(400, "Enter a valid email address.");
  return clean;
}

export function phone(value: unknown, required: boolean): string {
  const clean = text(value, { label: "phone number", max: 40, required });
  if (!clean) return "";
  const digits = clean.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || !/^[0-9+().\-\s]+$/.test(clean)) {
    throw new HttpError(400, "Enter a valid phone number.");
  }
  return clean;
}

/** A Firestore document id from the browser. It must not contain a path separator. */
export function docId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value) || /^\.+$/.test(value)) {
    throw new HttpError(400, "The request is not valid.");
  }
  return value;
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "The request is not valid.");
  }
  return value as Record<string, unknown>;
}

export interface ContactInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  message: string;
}

export function validateContact(body: Record<string, unknown>): ContactInput {
  return {
    firstName: text(body.firstName, { label: "first name", max: 60, required: true }),
    lastName: text(body.lastName, { label: "last name", max: 60, required: true }),
    email: email(body.email),
    phone: phone(body.phone, false),
    message: text(body.message, { label: "message", max: 2000, required: true, multiline: true })
  };
}

export interface SignupInput {
  email: string;
  source: string;
}

export function validateSignup(body: Record<string, unknown>): SignupInput {
  const source = typeof body.source === "string" ? body.source.trim().toLowerCase() : "";
  if (!/^[a-z0-9_-]{1,40}$/.test(source)) throw new HttpError(400, "The request is not valid.");
  return { email: email(body.email), source };
}

export interface ReceiptInput {
  ticketId: string;
  toEmail: string;
  includeSignupLink: boolean;
}

export function validateReceipt(body: Record<string, unknown>): ReceiptInput {
  return {
    ticketId: docId(body.ticketId),
    toEmail: email(body.toEmail),
    includeSignupLink: body.includeSignupLink === true
  };
}
