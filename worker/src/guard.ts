import { HttpError } from "./http";

/** True if the hidden honeypot field has a value. A real customer does not fill it. */
export function isHoneypotFilled(body: Record<string, unknown>): boolean {
  const value = body.website;
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim() !== "";
}

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Verifies the Turnstile token. With no secret key (local development) it does not verify. */
export async function verifyTurnstile(
  token: unknown,
  secret: string | undefined,
  remoteIp: string | null,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  if (!secret) {
    console.warn("TURNSTILE_SECRET_KEY is not set. The Turnstile check did not run.");
    return;
  }
  const failure = new HttpError(400, "Complete the security check, then try again.");
  if (typeof token !== "string" || !token || token.length > 2048) throw failure;
  const form = new URLSearchParams({ secret, response: token });
  if (remoteIp) form.set("remoteip", remoteIp);
  let result: { success?: boolean } | null = null;
  try {
    const response = await fetchFn(VERIFY_URL, { method: "POST", body: form });
    result = (await response.json()) as { success?: boolean };
  } catch (error) {
    console.error("Turnstile verification failed", error);
    throw new HttpError(503, "The security check is not available now. Try again later.");
  }
  if (!result?.success) throw failure;
}
