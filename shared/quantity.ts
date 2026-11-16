// Quantity text. See docs/V1_DESIGN.md section 5.
// The dozen term is only for 6 and for full dozens.

/** 6 -> "6 (half dozen)", 12 -> "12 (1 dozen)", 24 -> "24 (2 dozen)", 5 -> "5 tamales", 1 -> "1 tamale". */
export function quantityLabel(tamales: number): string {
  if (tamales === 6) return "6 (half dozen)";
  if (tamales > 0 && tamales % 12 === 0) return `${tamales} (${tamales / 12} dozen)`;
  return tamales === 1 ? "1 tamale" : `${tamales} tamales`;
}
