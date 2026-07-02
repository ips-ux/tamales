import { describe, expect, it } from "vitest";
import { menuProducts } from "../src/data/fixtures";
import { buildOrderLines, calculateTotals, canTransitionOrder } from "../src/lib/order";

describe("order calculations", () => {
  it("uses current server-side package prices", () => {
    const lines = buildOrderLines([
      { productId: "red-tamales", variantId: "red-dozen", quantity: 2 }
    ]);
    expect(lines[0].unitPriceCents).toBe(3400);
    expect(lines[0].lineTotalCents).toBe(6800);
  });

  it("calculates subtotal, tax, and total in integer cents", () => {
    const lines = buildOrderLines([
      { productId: "red-tamales", variantId: "red-dozen", quantity: 1 },
      { productId: "green-tamales", variantId: "green-half-dozen", quantity: 1 }
    ]);
    expect(calculateTotals(lines)).toEqual({
      subtotalCents: 5200,
      taxCents: 452,
      feeCents: 0,
      totalCents: 5652
    });
  });

  it("rejects sold-out products", () => {
    const soldOutProducts = menuProducts.map((product) =>
      product.id === "red-tamales" ? { ...product, status: "sold_out" as const } : product
    );
    expect(() =>
      buildOrderLines(
        [{ productId: "red-tamales", variantId: "red-dozen", quantity: 1 }],
        soldOutProducts
      )
    ).toThrow("not orderable");
  });

  it("rejects disabled variants", () => {
    const disabledVariantProducts = menuProducts.map((product) =>
      product.id === "green-tamales"
        ? {
            ...product,
            variants: product.variants.map((variant) =>
              variant.id === "green-dozen" ? { ...variant, active: false } : variant
            )
          }
        : product
    );
    expect(() =>
      buildOrderLines(
        [{ productId: "green-tamales", variantId: "green-dozen", quantity: 1 }],
        disabledVariantProducts
      )
    ).toThrow("unavailable");
  });
});

describe("order status transitions", () => {
  it("allows sensible forward movement", () => {
    expect(canTransitionOrder("new", "confirmed")).toBe(true);
    expect(canTransitionOrder("confirmed", "ready")).toBe(true);
    expect(canTransitionOrder("ready", "completed")).toBe(true);
  });

  it("blocks reopening completed orders through normal transition flow", () => {
    expect(canTransitionOrder("completed", "ready")).toBe(false);
    expect(canTransitionOrder("canceled", "confirmed")).toBe(false);
  });
});
