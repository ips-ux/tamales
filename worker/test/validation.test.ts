import { describe, expect, it } from "vitest";
import { isHoneypotFilled, verifyTurnstile } from "../src/guard";
import { HttpError, MAX_BODY_BYTES, parseJsonBody } from "../src/http";
import { docId, email, phone, text, validateContact, validateReceipt, validateSignup } from "../src/validate";

const contact = {
  firstName: " Jane ",
  lastName: "Doe",
  email: "Jane.Doe@Example.com",
  phone: "720-360-8688",
  message: "Do you sell green tamales?\r\nThanks."
};

function status(run: () => unknown): number {
  try {
    run();
  } catch (error) {
    return error instanceof HttpError ? error.status : -1;
  }
  return 200;
}

describe("contact validation", () => {
  it("cleans and returns a valid message", () => {
    expect(validateContact(contact)).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.doe@example.com",
      phone: "720-360-8688",
      message: "Do you sell green tamales?\nThanks."
    });
  });

  it("accepts an empty phone number", () => {
    expect(validateContact({ ...contact, phone: "" }).phone).toBe("");
    expect(validateContact({ ...contact, phone: undefined }).phone).toBe("");
  });

  it("rejects a missing name, a bad email address and a long message", () => {
    expect(() => validateContact({ ...contact, firstName: "  " })).toThrow("Enter your first name.");
    expect(() => validateContact({ ...contact, email: "jane@example" })).toThrow("Enter a valid email address.");
    expect(() => validateContact({ ...contact, email: "" })).toThrow("Enter your email address.");
    expect(() => validateContact({ ...contact, message: "x".repeat(2001) })).toThrow("The limit is 2000 characters.");
    expect(status(() => validateContact({ ...contact, lastName: 42 }))).toBe(400);
  });

  it("rejects a phone number that is not a phone number", () => {
    expect(() => phone("call me", false)).toThrow("Enter a valid phone number.");
    expect(() => phone("123", false)).toThrow("Enter a valid phone number.");
    expect(() => phone("", true)).toThrow("Enter your phone number.");
  });
});

describe("field helpers", () => {
  it("removes control characters and line breaks from 1-line text", () => {
    expect(text("Jane\r\nBcc: x@y.z\u0000", { label: "name", max: 60 })).toBe("Jane Bcc: x@y.z");
  });

  it("rejects an email address with a space, a quote or 2 addresses", () => {
    for (const bad of ["a b@c.com", 'a"b@c.com', "a@b.com,c@d.com", "a@@b.com", "<a@b.com>", `${"a".repeat(200)}@b.com`]) {
      expect(() => email(bad)).toThrow();
    }
    expect(email("  A@B.co ")).toBe("a@b.co");
  });

  it("rejects a document id with a path separator", () => {
    expect(docId("abc_DEF-123")).toBe("abc_DEF-123");
    for (const bad of ["a/b", "..", "", "a b", 7, null, "x".repeat(201)]) {
      expect(status(() => docId(bad))).toBe(400);
    }
  });
});

describe("signup and receipt validation", () => {
  it("returns the email address in lower case", () => {
    expect(validateSignup({ email: "Jane@Example.com", source: "Landing" })).toEqual({
      email: "jane@example.com",
      source: "landing"
    });
  });

  it("rejects a source that is not a short word", () => {
    expect(status(() => validateSignup({ email: "jane@example.com", source: "<script>" }))).toBe(400);
    expect(status(() => validateSignup({ email: "jane@example.com" }))).toBe(400);
  });

  it("validates a receipt request", () => {
    expect(validateReceipt({ ticketId: "abc123", toEmail: "Jane@Example.com", includeSignupLink: "yes" })).toEqual({
      ticketId: "abc123",
      toEmail: "jane@example.com",
      includeSignupLink: false
    });
    expect(status(() => validateReceipt({ ticketId: "a/b", toEmail: "jane@example.com" }))).toBe(400);
  });
});

describe("honeypot", () => {
  it("is empty for a real customer", () => {
    expect(isHoneypotFilled({})).toBe(false);
    expect(isHoneypotFilled({ website: "" })).toBe(false);
    expect(isHoneypotFilled({ website: "   " })).toBe(false);
  });

  it("is filled for a bot", () => {
    expect(isHoneypotFilled({ website: "https://spam.example" })).toBe(true);
    expect(isHoneypotFilled({ website: 1 })).toBe(true);
  });
});

describe("body size", () => {
  it("rejects a body over the limit", () => {
    const large = JSON.stringify({ message: "x".repeat(MAX_BODY_BYTES) });
    expect(status(() => parseJsonBody(large))).toBe(413);
  });

  it("rejects text that is not a JSON object", () => {
    expect(status(() => parseJsonBody("not json"))).toBe(400);
    expect(status(() => parseJsonBody("[1]"))).toBe(400);
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
  });
});

describe("Turnstile", () => {
  const reply = (success: boolean) => (async () => Response.json({ success })) as unknown as typeof fetch;

  it("does not verify when the secret is not set", async () => {
    const never = (async () => {
      throw new Error("no network in tests");
    }) as unknown as typeof fetch;
    await expect(verifyTurnstile("", undefined, null, never)).resolves.toBeUndefined();
  });

  it("rejects an empty token and a failed check", async () => {
    await expect(verifyTurnstile("", "secret", null, reply(true))).rejects.toThrow("Complete the security check");
    await expect(verifyTurnstile("token", "secret", null, reply(false))).rejects.toThrow("Complete the security check");
  });

  it("accepts a token that Cloudflare confirms", async () => {
    await expect(verifyTurnstile("token", "secret", "1.2.3.4", reply(true))).resolves.toBeUndefined();
  });
});
