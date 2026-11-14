// Customer record, keyed by a hash of the email address. See docs/V1_FUNDAMENTALS.md section 13.

import { sha256Hex } from "./base64";
import type { Firestore } from "./firestore";

export interface CustomerInput {
  email: string;
  firstName?: string;
  lastName?: string;
  /** True records the opt-in. False or no value does not change a stored opt-in. */
  marketingOptIn?: boolean;
}

/** Stable document id: SHA-256 of the email address in lower case, as hex. */
export function customerIdFor(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}

export interface CustomerWrite {
  data: Record<string, unknown>;
  /** Fields to change in a document that exists. No value means a new document. */
  mergeFields?: string[];
}

/** Decides what to write. It does not change `marketingOptIn` from true to false. */
export function buildCustomerWrite(
  existing: Record<string, unknown> | null,
  input: CustomerInput,
  nowIso: string
): CustomerWrite {
  const email = input.email.trim().toLowerCase();
  const firstName = input.firstName?.trim() ?? "";
  const lastName = input.lastName?.trim() ?? "";
  if (!existing) {
    return {
      data: {
        email,
        firstName,
        lastName,
        marketingOptIn: input.marketingOptIn === true,
        createdAtUtc: nowIso,
        updatedAtUtc: nowIso
      }
    };
  }
  const data: Record<string, unknown> = { email, updatedAtUtc: nowIso };
  if (firstName) data.firstName = firstName;
  if (lastName) data.lastName = lastName;
  if (input.marketingOptIn === true) data.marketingOptIn = true;
  return { data, mergeFields: Object.keys(data) };
}

/** Creates or updates the customer record. Returns the customer id. */
export async function upsertCustomer(db: Firestore, input: CustomerInput): Promise<string> {
  const id = await customerIdFor(input.email);
  const path = `customers/${id}`;
  const write = buildCustomerWrite(await db.get(path), input, new Date().toISOString());
  await db.set(path, write.data, write.mergeFields);
  return id;
}

/** Splits "Jane Mary Doe" into first name "Jane" and last name "Mary Doe". */
export function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}
