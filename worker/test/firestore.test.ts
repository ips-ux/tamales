import { describe, expect, it } from "vitest";
import { buildCustomerWrite, customerIdFor, splitName } from "../src/customers";
import { Firestore } from "../src/firestore";
import { decodeFields, decodeValue, encodeFields, encodeValue } from "../src/firestoreValues";

describe("Firestore value codec", () => {
  it("encodes each type", () => {
    expect(encodeValue(null)).toEqual({ nullValue: null });
    expect(encodeValue(true)).toEqual({ booleanValue: true });
    expect(encodeValue(3400)).toEqual({ integerValue: "3400" });
    expect(encodeValue(-1)).toEqual({ integerValue: "-1" });
    expect(encodeValue(8.7)).toEqual({ doubleValue: 8.7 });
    expect(encodeValue("")).toEqual({ stringValue: "" });
    expect(encodeValue(["a", 1])).toEqual({
      arrayValue: { values: [{ stringValue: "a" }, { integerValue: "1" }] }
    });
    expect(encodeValue({ a: { b: false } })).toEqual({
      mapValue: { fields: { a: { mapValue: { fields: { b: { booleanValue: false } } } } } }
    });
  });

  it("drops undefined keys", () => {
    expect(encodeFields({ a: 1, b: undefined })).toEqual({ a: { integerValue: "1" } });
  });

  it("decodes each type", () => {
    expect(decodeValue({ integerValue: "870" })).toBe(870);
    expect(decodeValue({ doubleValue: 1.5 })).toBe(1.5);
    expect(decodeValue({ timestampValue: "2026-11-14T00:00:00Z" })).toBe("2026-11-14T00:00:00Z");
    expect(decodeValue({ nullValue: null })).toBeNull();
    expect(decodeValue({ arrayValue: {} })).toEqual([]);
    expect(decodeValue({ mapValue: {} })).toEqual({});
    expect(decodeFields(undefined)).toEqual({});
  });

  it("returns the same data after encode and decode", () => {
    const order = {
      orderNumber: "BBT-2026-ABCDE",
      status: "new",
      customer: { name: "Jane Doe", notes: "", optIn: false },
      items: [{ productId: "red", quantity: 2, unitPriceCents: 3400, tags: [] }],
      totals: { subtotalCents: 6800, taxCents: 592, rate: 8.7 },
      nothing: null
    };
    expect(decodeFields(encodeFields(order))).toEqual(order);
  });
});

describe("Firestore client", () => {
  function client(responses: Response[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return responses.shift() as Response;
    }) as unknown as typeof fetch;
    return { db: new Firestore("demo", async () => "token", fetchFn), calls };
  }
  const base = "https://firestore.googleapis.com/v1/projects/demo/databases/(default)/documents";

  it("reads a document and returns null for 404", async () => {
    const { db, calls } = client([
      Response.json({ name: "x", fields: { taxRateBps: { integerValue: "870" } } }),
      new Response("{}", { status: 404 })
    ]);
    expect(await db.get("settings/business")).toEqual({ taxRateBps: 870 });
    expect(await db.get("settings/none")).toBeNull();
    expect(calls[0].url).toBe(`${base}/settings/business`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer token");
  });

  it("lists all pages of a collection", async () => {
    const { db, calls } = client([
      Response.json({ documents: [{ name: `${base}/menuItems/red`, fields: {} }], nextPageToken: "p2" }),
      Response.json({ documents: [{ name: `${base}/menuItems/green`, fields: { name: { stringValue: "Green" } } }] })
    ]);
    expect(await db.list("menuItems")).toEqual([
      { id: "red", data: {} },
      { id: "green", data: { name: "Green" } }
    ]);
    expect(calls[1].url).toContain("pageToken=p2");
  });

  it("writes with an update mask for a merge", async () => {
    const { db, calls } = client([Response.json({}), Response.json({})]);
    await db.set("customers/abc", { email: "a@b.co" });
    await db.set("customers/abc", { email: "a@b.co", updatedAtUtc: "now" }, ["email", "updatedAtUtc"]);
    expect(calls[0].url).toBe(`${base}/customers/abc`);
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ fields: { email: { stringValue: "a@b.co" } } });
    expect(calls[1].url).toBe(`${base}/customers/abc?updateMask.fieldPaths=email&updateMask.fieldPaths=updatedAtUtc`);
  });

  it("throws when Firestore returns an error", async () => {
    const { db } = client([new Response("denied", { status: 403 })]);
    await expect(db.set("orders/x", {})).rejects.toThrow("403");
  });
});

describe("customer record", () => {
  const now = "2026-11-13T00:00:00.000Z";

  it("uses a stable id from the email address in lower case", async () => {
    const id = await customerIdFor(" Jane@Example.com ");
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await customerIdFor("jane@example.com")).toBe(id);
    expect(await customerIdFor("june@example.com")).not.toBe(id);
  });

  it("creates a full record", () => {
    expect(buildCustomerWrite(null, { email: "Jane@Example.com", firstName: "Jane", lastName: "Doe" }, now)).toEqual({
      data: {
        email: "jane@example.com",
        firstName: "Jane",
        lastName: "Doe",
        marketingOptIn: false,
        createdAtUtc: now,
        updatedAtUtc: now
      }
    });
  });

  it("does not change the opt-in from true to false", () => {
    const existing = { email: "jane@example.com", firstName: "Jane", lastName: "Doe", marketingOptIn: true };
    const write = buildCustomerWrite(existing, { email: "jane@example.com", marketingOptIn: false }, now);
    expect(write.mergeFields).toEqual(["email", "updatedAtUtc"]);
    expect(write.data).not.toHaveProperty("marketingOptIn");
    expect(write.data).not.toHaveProperty("createdAtUtc");
  });

  it("records a new opt-in and does not erase a name with an empty value", () => {
    const write = buildCustomerWrite({ firstName: "Jane" }, { email: "jane@example.com", firstName: "", marketingOptIn: true }, now);
    expect(write.mergeFields).toEqual(["email", "updatedAtUtc", "marketingOptIn"]);
    expect(write.data.marketingOptIn).toBe(true);
  });

  it("splits a full name", () => {
    expect(splitName("  Jane Mary Doe ")).toEqual({ firstName: "Jane", lastName: "Mary Doe" });
    expect(splitName("Jane")).toEqual({ firstName: "Jane", lastName: "" });
  });
});
