// Pure helpers for the contact messages list (Admin > Contacts).

const REPLY_SUBJECT = "Re: Your message to Bangin Bustos Tamales";

/** A mailto link that starts a reply with a "Re:" subject. */
export function contactReplyHref(email: string): string {
  // Remove characters that can add a second header or a second address part.
  const address = email.trim().replace(/[\s?&#,;<>"]/g, "");
  return `mailto:${address}?subject=${encodeURIComponent(REPLY_SUBJECT)}`;
}

/** A tel link, or an empty string when the phone has no digits. */
export function contactPhoneHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

/** "First Last", or a fallback when the message has no name. */
export function contactDisplayName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") || "No name";
}
