import { afterEach, describe, expect, it, vi } from "vitest";
import { Firestore } from "../src/firestore";

// Workers throw "Illegal invocation" when the global fetch is called with an
// object as `this`. This test makes the stub do the same.
describe("Firestore default fetch", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("calls the global fetch without a receiver", async () => {
    const strictFetch = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    globalThis.fetch = strictFetch as unknown as typeof fetch;
    const db = new Firestore("demo", async () => "token");
    await expect(db.get("settings/business")).resolves.toBeNull();
    expect(strictFetch).toHaveBeenCalledTimes(1);
  });
});
