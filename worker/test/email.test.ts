import { describe, expect, it } from "vitest";
import { sendEmail, sendEmailSafely } from "../src/email";
import { buildEmailHtml, buildEmailText, escapeHtml } from "../src/emailHtml";
import { buildContactEmail, buildReceiptEmail } from "../src/messages";

const cfg = { ownerEmail: "owner@example.com", siteOrigin: "https://bustostamales.com" };

const ticket = {
  ticketNumber: "1113-0042",
  customerName: `Jane "<img src=x onerror=alert(1)>" O'Doe`,
  paymentMethod: "cashapp",
  createdAtUtc: "2026-11-15T00:30:00.000Z",
  items: [
    { productId: "red", productName: "Red <b>Tamale</b> & Salsa", quantity: 3, unitPriceCents: 400 },
    { productId: "green", productName: "Green Tamale", quantity: 1, unitPriceCents: 400 }
  ],
  subtotalCents: 1600,
  taxCents: 139,
  totalCents: 1739
};

describe("escapeHtml", () => {
  it("escapes the 5 special characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });
});

describe("POS receipt", () => {
  const message = buildReceiptEmail(ticket, { toEmail: "jane@example.com", includeSignupLink: false, timeZone: "America/Denver" }, cfg);
  const html = buildEmailHtml(message.content);

  it("escapes customer text and menu item names", () => {
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Tamale</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Red &lt;b&gt;Tamale&lt;/b&gt; &amp; Salsa");
    expect(html).toContain("O&#39;Doe");
  });

  it("uses the approved labels and formats", () => {
    expect(message.subject).toBe("Your receipt: 1113-0042");
    for (const label of ["Order number", "Subtotal", "Tax", "Total", "Payment", "Cash App"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).not.toMatch(/Taxes|Order Total|Ticket/);
    expect(html).toContain("Sat, Nov 14, 5:30 PM MT");
    expect(html).toContain("Quantity 3 x $4.00");
    expect(html).toContain("$12.00");
    expect(html).toContain("$17.39");
  });

  it("follows the email layout rules", () => {
    expect(html).not.toMatch(/<style|display:\s*(flex|grid)|@media/);
    expect(html).toContain('role="presentation"');
    expect(html).toContain("max-width:520px");
    expect(html).toContain("owner@example.com");
  });

  it("has no email list button unless the request asks for it", () => {
    expect(html).not.toContain("/updates");
    const withLink = buildReceiptEmail(
      ticket,
      { toEmail: "jane+tamales@example.com", includeSignupLink: true, timeZone: "America/Denver" },
      cfg
    );
    const linked = buildEmailHtml(withLink.content);
    expect(linked).toContain('href="https://bustostamales.com/updates?email=jane%2Btamales%40example.com"');
    expect(linked).toContain("Join the Email List");
  });

  it("has a plain-text version", () => {
    const text = buildEmailText(message.content);
    expect(text).toContain("Order number: 1113-0042");
    expect(text).toContain("Total: $17.39");
  });
});

describe("contact message alert", () => {
  const message = buildContactEmail(
    { firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "", message: "Line 1\n<script>x</script>" },
    "2026-11-15T00:30:00.000Z",
    "America/Denver",
    cfg
  );

  it("goes to the owner with reply-to set to the customer", () => {
    expect(message.to).toBe("owner@example.com");
    expect(message.replyTo).toBe("jane@example.com");
    expect(message.subject).toBe("New contact message: Jane Doe");
  });

  it("escapes the message and keeps the line breaks", () => {
    const html = buildEmailHtml(message.content);
    expect(html).toContain("Line 1<br />&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("sendEmail", () => {
  const message = buildContactEmail(
    { firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "", message: "Hello" },
    "2026-11-15T00:30:00.000Z",
    "America/Denver",
    cfg
  );

  it("posts to Resend with the key, the sender and reply_to", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ id: "1" });
    }) as unknown as typeof fetch;
    await sendEmail({ apiKey: "re_test", from: "BBT <orders@bustostamales.com>", fetchFn }, message);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body).toMatchObject({
      from: "BBT <orders@bustostamales.com>",
      to: ["owner@example.com"],
      reply_to: "jane@example.com",
      subject: "New contact message: Jane Doe"
    });
    expect(body.html).toContain("Hello");
    expect(body.text).toContain("Hello");
  });

  it("does not throw from sendEmailSafely when Resend fails", async () => {
    const fetchFn = (async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    const mailer = { apiKey: "re_test", from: "x", fetchFn };
    await expect(sendEmail(mailer, message)).rejects.toThrow("Resend error (500)");
    await expect(sendEmailSafely(mailer, message)).resolves.toBeUndefined();
  });

  it("sends nothing when the key is not set", async () => {
    const fetchFn = (async () => {
      throw new Error("must not call");
    }) as unknown as typeof fetch;
    await expect(sendEmail({ apiKey: undefined, from: "x", fetchFn }, message)).resolves.toBeUndefined();
  });
});
