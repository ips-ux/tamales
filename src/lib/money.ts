export function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

export function calculateTax(subtotalCents: number, taxRateBps: number): number {
  return Math.round((subtotalCents * taxRateBps) / 10_000);
}
