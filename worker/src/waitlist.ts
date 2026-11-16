// POST /api/v1/waitlist: "Join the Next Batch". The contract is `WaitlistInput` in shared/model.ts.

import { addToEmailList, upsertCustomer } from "./customers";
import type { Firestore } from "./firestore";
import { docId, email, text } from "./validate";
import type { WaitlistEntry, WaitlistInput } from "../../shared/model";

export function validateWaitlist(body: Record<string, unknown>): WaitlistInput {
  const eventId = body.eventId === undefined || body.eventId === null || body.eventId === "" ? "" : docId(body.eventId);
  return {
    firstName: text(body.firstName, { label: "first name", max: 60, required: true }),
    lastName: text(body.lastName, { label: "last name", max: 60, required: true }),
    email: email(body.email),
    interest: text(body.interest, { label: "note", max: 300 }),
    eventId,
    marketingOptIn: body.marketingOptIn === true
  };
}

/** Saves `waitlist/{id}`. With the opt-in, it also adds the customer to the email list. */
export async function joinWaitlist(
  body: Record<string, unknown>,
  db: Firestore,
  now = new Date()
): Promise<WaitlistEntry> {
  const input = validateWaitlist(body);
  const event = input.eventId ? await db.get(`events/${input.eventId}`) : null;
  const nowIso = now.toISOString();
  const entry: WaitlistEntry = {
    id: crypto.randomUUID(),
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    interest: input.interest,
    // An event id that does not exist is not saved.
    eventId: event ? input.eventId : "",
    eventName: typeof event?.name === "string" ? event.name : "",
    createdAtUtc: nowIso
  };
  await db.set(`waitlist/${entry.id}`, entry as unknown as Record<string, unknown>);
  if (input.marketingOptIn) {
    await upsertCustomer(db, {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      marketingOptIn: true
    });
    await addToEmailList(db, input.email, "waitlist", nowIso);
  }
  return entry;
}
