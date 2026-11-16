// Build piece 3: money. Pure rules for PayPal Checkout on the tracker, the online
// ordering fee in the order flow, the payment settings, refunds, POS sale changes and reports.
import { describe, expect, it } from "vitest";
import { orderingDefaults, type OrderRecord, type TrackerRecord } from "../shared/model";
import type { LedgerEntry } from "../shared/moneyModel";
import { onlineFeeCents } from "../shared/pricing";
import {
  actionBlocked,
  availableActions,
  canCancelWithRefund,
  canRefund,
  checkRefund,
  handOverHint,
  paymentFacts,
  paymentSummary,
  refundFormFor,
  refundRemainingCents
} from "../src/components/admin/orderRules";
import { posPaymentLabel } from "../src/components/admin/paymentLabels";
import {
  bpsToPercentText,
  checkPaymentSettings,
  feeExample,
  paymentSettingsToForm
} from "../src/components/admin/paymentSettings";
import {
  editDetail,
  editLedgerFields,
  reasonError,
  saleActions,
  saleChanged,
  voidLedgerFields,
  type SaleFields
} from "../src/components/admin/saleRules";
import {
  estimateOrder,
  paymentChoices,
  reviewPaymentNote,
  submitLabel,
  usesPayPalCheckout,
  validatePayment,
  type FlowMenuItem
} from "../src/components/order/orderFlowLogic";
import {
  countdownText,
  payDeadline,
  payErrorMessage,
  paypalClientId,
  paypalSdkUrl,
  refundText
} from "../src/components/tracker/payRules";
import { canPayOnline, paymentHelp, trackerView } from "../src/components/tracker/trackerRules";
import { paypalFeeCents } from "../src/lib/onlineFee";
import {
  buildBalanceSheet,
  buildIncomeStatement,
  buildSalesTaxReport,
  customerDepositsCents,
  inPeriodByKey,
  ledgerAdjustments,
  ledgerAmountText,
  ledgerEntriesInPeriod,
  reportSales,
  type Period,
  type SaleRecord
} from "../src/lib/reports";

const dayKeyOf = (iso: string) => iso.slice(0, 10);
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function tracker(overrides: Partial<TrackerRecord> = {}): TrackerRecord {
  return {
    payByUtc: "",
    refundedCents: 0,
    orderNumber: "BBT-1042",
    kind: "preorder",
    state: "approved",
    paymentState: "unpaid",
    paymentMethod: "paypal",
    paymentDescription: "",
    firstName: "Jane",
    eventName: "Winter Market",
    fulfillment: "event_pickup",
    items: [],
    totals: { subtotalCents: 3600, deliveryFeeCents: 0, onlineFeeCents: 93, taxCents: 313, totalCents: 4006 },
    reason: "",
    scheduledAtUtc: "",
    updatedAtUtc: "2026-11-14T18:00:00.000Z",
    ...overrides
  };
}

function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "o1",
    kind: "preorder",
    source: "web",
    state: "received",
    paymentState: "paid",
    paymentMethod: "paypal",
    orderNumber: "BBT-1042",
    sequence: 1042,
    paymentDescription: "",
    eventId: "ev1",
    eventName: "Winter Market",
    fulfillment: "event_pickup",
    customer: { firstName: "Jane", lastName: "Doe", email: "jane@example.com", phone: "", marketingOptIn: false },
    customerId: "c1",
    items: [],
    tamaleCount: 12,
    totals: { subtotalCents: 3600, deliveryFeeCents: 0, onlineFeeCents: 93, taxCents: 313, totalCents: 4006 },
    delivery: null,
    requested: null,
    scheduledAtUtc: "",
    customerNote: "",
    ownerNote: "",
    reason: "",
    trackerToken: "t1",
    createdAtUtc: "2026-11-10T18:00:00.000Z",
    updatedAtUtc: "2026-11-10T18:00:00.000Z",
    approvedAtUtc: "",
    payByUtc: "",
    stockHeld: true,
    paypalOrderId: "PP-1",
    paypalCaptureId: "CAP-1",
    paypalFeeCents: 189,
    paidAtUtc: "2026-11-10T18:02:00.000Z",
    refundedCents: 0,
    saleId: "",
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

describe("PayPal Checkout on the tracker", () => {
  it("lets an approved, unpaid pre-order or batch request pay", () => {
    expect(canPayOnline(tracker())).toBe(true);
    expect(canPayOnline(tracker({ kind: "batch", paymentMethod: "unset" }))).toBe(true);
    expect(canPayOnline(tracker({ state: "requested" }))).toBe(false);
    expect(canPayOnline(tracker({ state: "expired" }))).toBe(false);
    expect(canPayOnline(tracker({ paymentState: "paid", state: "received" }))).toBe(false);
  });

  it("lets a live order with PayPal pay until it is final", () => {
    const live = { kind: "live" as const, paymentMethod: "paypal" as const };
    expect(canPayOnline(tracker({ ...live, state: "received" }))).toBe(true);
    expect(canPayOnline(tracker({ ...live, state: "ready" }))).toBe(true);
    expect(canPayOnline(tracker({ ...live, state: "canceled" }))).toBe(false);
    expect(canPayOnline(tracker({ ...live, state: "handed_over" }))).toBe(false);
    expect(canPayOnline(tracker({ kind: "live", paymentMethod: "cash", state: "received" }))).toBe(false);
    expect(canPayOnline(tracker({ ...live, state: "received", paymentState: "check_payment" }))).toBe(false);
  });

  it("shows the PayPal block, then the paid line", () => {
    const handles = { venmoHandle: "", cashAppCashtag: "" };
    expect(paymentHelp(tracker(), handles)).toEqual({ type: "paypal" });
    expect(paymentHelp(tracker({ state: "received", paymentState: "paid" }), handles)).toEqual({
      type: "text",
      text: "Payment received."
    });
    expect(paymentHelp(tracker({ state: "expired" }), handles)).toEqual({ type: "none" });
  });

  it("has no payment link text for an approved order", () => {
    expect(trackerView(tracker())).toMatchObject({ label: "Approved. Pay to confirm.", detail: "" });
    expect(trackerView(tracker({ state: "expired" }))).toMatchObject({
      label: "Canceled",
      detail: "We did not receive the payment in time."
    });
  });

  it("builds the SDK address", () => {
    expect(paypalSdkUrl("abc 123")).toBe(
      "https://www.paypal.com/sdk/js?client-id=abc%20123&currency=USD&intent=capture&enable-funding=venmo"
    );
    expect(paypalClientId("  abc ")).toBe("abc");
    expect(paypalClientId(undefined)).toBe("");
  });

  it("counts down under 1 hour and shows the date above that", () => {
    const now = Date.parse("2026-11-14T18:00:00.000Z");
    const format = (iso: string) => `[${iso}]`;
    expect(countdownText(754_000)).toBe("12:34");
    expect(countdownText(59_001)).toBe("1:00");
    expect(countdownText(-5)).toBe("0:00");
    expect(payDeadline("2026-11-14T18:12:34.000Z", now, format)).toEqual({
      text: "Pay in 12:34 to keep your tamales.",
      live: true
    });
    expect(payDeadline("2026-11-17T18:00:00.000Z", now, format)).toEqual({
      text: "Pay by [2026-11-17T18:00:00.000Z].",
      live: false
    });
    expect(payDeadline("2026-11-14T17:00:00.000Z", now, format)).toEqual({
      text: "Pay now to keep your tamales.",
      live: false
    });
    expect(payDeadline("", now, format)).toEqual({ text: "", live: false });
  });

  it("shows the refunded amount and the payment error", () => {
    expect(refundText({ refundedCents: 0 })).toBe("");
    expect(refundText({ refundedCents: 1250 })).toBe("We refunded $12.50.");
    expect(payErrorMessage("This order is paid.")).toBe("This order is paid.");
    expect(payErrorMessage("  ")).toBe("We could not take the payment. Try again.");
  });
});

// ---------------------------------------------------------------------------
// Order flow
// ---------------------------------------------------------------------------

const menu: FlowMenuItem[] = [
  {
    id: "red",
    name: "Red Tamales",
    status: "active",
    singlePriceCents: 400,
    bulkMenuEnabled: true,
    showWhenSoldOut: false,
    sortOrder: 1,
    variants: [
      { id: "dozen", label: "Dozen", unitQuantity: 12, priceCents: 3600, minimumQuantity: 1, active: true, sortOrder: 1 }
    ]
  }
];

describe("online ordering fee in the order flow", () => {
  it("uses PayPal Checkout for each pre-order and batch request, and for a live order that selects it", () => {
    expect(usesPayPalCheckout("preorder", "unset")).toBe(true);
    expect(usesPayPalCheckout("batch", "unset")).toBe(true);
    expect(usesPayPalCheckout("live", "paypal")).toBe(true);
    expect(usesPayPalCheckout("live", "cash")).toBe(false);
    expect(usesPayPalCheckout("live", "unset")).toBe(false);
  });

  it("adds the fee with the formula of the Worker", () => {
    const base = { deliveryFeeCents: 0, taxRateBps: 870, deliveryFeeTaxable: false };
    const lines = [{ itemId: "red", variantId: "dozen", quantity: 1 }];
    const plain = estimateOrder(lines, menu, base);
    expect(plain.totals).toMatchObject({ subtotalCents: 3600, taxCents: 313, onlineFeeCents: 0, totalCents: 3913 });

    const paypal = estimateOrder(lines, menu, { ...base, usesPayPal: true, feeSettings: orderingDefaults });
    // round(50% of (3913 x 3.49% + 49)) = round(92.78) = 93
    expect(paypal.totals.onlineFeeCents).toBe(93);
    expect(paypal.totals.onlineFeeCents).toBe(onlineFeeCents(3913, orderingDefaults));
    expect(paypal.totals.taxCents).toBe(313);
    expect(paypal.totals.totalCents).toBe(4006);
  });

  it("puts PayPal first when the site has it", () => {
    const handles = { venmoHandle: "bbt", cashAppCashtag: "" };
    expect(paymentChoices(handles, true).map((row) => row.label)).toEqual([
      "PayPal or card",
      "Venmo",
      "Cash at the booth"
    ]);
    expect(paymentChoices(handles, false).map((row) => row.method)).toEqual(["venmo", "cash"]);
    expect(validatePayment("paypal", ["paypal", "cash"])).toEqual([]);
    expect(validatePayment("paypal", ["cash"])).toEqual(["Select a payment method."]);
  });

  it("names the last button and the payment line of the Review step", () => {
    expect(submitLabel("preorder", { preorderMode: "fixed" })).toBe("Continue to Payment");
    expect(submitLabel("preorder", { preorderMode: "open" })).toBe("Send Request");
    expect(submitLabel("batch")).toBe("Send Request");
    expect(submitLabel("live")).toBe("Place Order");

    expect(reviewPaymentNote("preorder", { preorderMode: "fixed" }, { holdMinutes: 15 })).toBe(
      "We hold your tamales for 15 minutes while you pay."
    );
    expect(reviewPaymentNote("preorder", { preorderMode: "fixed" }, { holdMinutes: 1 })).toBe(
      "We hold your tamales for 1 minute while you pay."
    );
    expect(reviewPaymentNote("preorder", { preorderMode: "open" }, { holdMinutes: 15 })).toBe(
      "You pay online after we approve your order."
    );
    expect(reviewPaymentNote("batch", undefined, { holdMinutes: 15 })).toBe(
      "You pay online after we approve your order."
    );
    expect(reviewPaymentNote("live", undefined, { holdMinutes: 15 })).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe("payment settings", () => {
  const form = paymentSettingsToForm(orderingDefaults);

  it("shows the stored values as text", () => {
    expect(form).toEqual({
      holdMinutes: "15",
      paymentWindowHours: "72",
      paypalFeePercent: "3.49",
      paypalFeeFixed: "0.49",
      feeSharePct: "50"
    });
    expect(bpsToPercentText(300)).toBe("3.00");
  });

  it("converts valid text to the stored values", () => {
    expect(checkPaymentSettings(form)).toEqual({
      errors: [],
      values: { holdMinutes: 15, paymentWindowHours: 72, paypalFeeBps: 349, paypalFeeFixedCents: 49, feeSharePct: 50 }
    });
    const edited = checkPaymentSettings({ ...form, paypalFeePercent: "2.9%", paypalFeeFixed: "$0.30", feeSharePct: "100" });
    expect(edited.values).toMatchObject({ paypalFeeBps: 290, paypalFeeFixedCents: 30, feeSharePct: 100 });
  });

  it("gives 1 instruction for each field that is not valid", () => {
    const result = checkPaymentSettings({
      holdMinutes: "0",
      paymentWindowHours: "1.5",
      paypalFeePercent: "abc",
      paypalFeeFixed: "9",
      feeSharePct: "101"
    });
    expect(result.values).toBeNull();
    expect(result.errors).toHaveLength(5);
    expect(result.errors[4]).toBe("Enter the customer share as a whole number from 0 to 100.");
  });

  it("shows the example line", () => {
    expect(paypalFeeCents(5000, orderingDefaults)).toBe(224);
    expect(feeExample(form)).toBe("On a $50.00 order: PayPal fee $2.24. The customer pays $1.12.");
    expect(feeExample({ ...form, feeSharePct: "0" })).toBe(
      "On a $50.00 order: PayPal fee $2.24. The customer pays $0.00."
    );
    expect(feeExample({ ...form, paypalFeePercent: "x" })).toBe("");
    // The example does not wait for the other fields.
    expect(feeExample({ ...form, holdMinutes: "" })).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// Owner order screens
// ---------------------------------------------------------------------------

describe("payment facts and refunds", () => {
  const format = (iso: string) => `[${iso.slice(0, 16)}]`;

  it("lists the payment facts", () => {
    expect(paymentSummary(order())).toBe("PayPal, Paid");
    expect(paymentSummary(order({ paymentMethod: "unset", paymentState: "unpaid" }))).toBe("Not paid");
    expect(paymentFacts(order({ refundedCents: 500 }), format)).toEqual([
      { label: "Paid", value: "[2026-11-10T18:02]" },
      { label: "PayPal fee", value: "$1.89" },
      { label: "Refunded", value: "$5.00" }
    ]);
    expect(
      paymentFacts(
        order({
          state: "approved",
          paymentState: "unpaid",
          paidAtUtc: "",
          paypalFeeCents: 0,
          payByUtc: "2026-11-13T18:00:00.000Z"
        }),
        format
      )
    ).toEqual([{ label: "Pay by", value: "[2026-11-13T18:00]" }]);
  });

  it("blocks the handover of an order that is not paid", () => {
    const unpaid = order({ state: "ready", paymentState: "check_payment", paypalCaptureId: "" });
    expect(availableActions(unpaid)).toContain("hand_over");
    expect(actionBlocked(unpaid, "hand_over")).toBe(true);
    expect(actionBlocked(unpaid, "cancel")).toBe(false);
    expect(handOverHint(unpaid)).toBe("Mark the order as paid first.");
    const paid = order({ state: "ready" });
    expect(actionBlocked(paid, "hand_over")).toBe(false);
    expect(handOverHint(paid)).toBe("");
    expect(handOverHint(order({ state: "requested", paymentState: "unpaid" }))).toBe("");
  });

  it("hides Mark as Unpaid after a PayPal capture", () => {
    expect(availableActions(order())).not.toContain("mark_unpaid");
    expect(availableActions(order({ paypalCaptureId: "", paymentMethod: "cash" }))).toContain("mark_unpaid");
  });

  it("offers a refund on a paid order while money remains", () => {
    expect(canRefund(order())).toBe(true);
    expect(canRefund(order({ state: "handed_over" }))).toBe(true);
    expect(canRefund(order({ paymentState: "unpaid" }))).toBe(false);
    expect(canRefund(order({ paymentState: "refunded", refundedCents: 4006 }))).toBe(false);
    expect(refundRemainingCents(order({ refundedCents: 1000 }))).toBe(3006);
    expect(refundFormFor(order({ refundedCents: 1000 }))).toEqual({ amount: "30.06", reason: "", cancelOrder: false });
    expect(canCancelWithRefund(order())).toBe(true);
    expect(canCancelWithRefund(order({ state: "handed_over" }))).toBe(false);
  });

  it("checks the Refund dialog", () => {
    const current = order({ refundedCents: 1000 });
    expect(checkRefund(current, { amount: "30.06", reason: " Short 1 dozen ", cancelOrder: true }).input).toEqual({
      orderId: "o1",
      amountCents: 3006,
      reason: "Short 1 dozen",
      cancelOrder: true
    });
    expect(checkRefund(current, { amount: "30.07", reason: "x", cancelOrder: false }).errors).toEqual([
      "Enter a refund of $30.06 or less."
    ]);
    expect(checkRefund(current, { amount: "0", reason: "", cancelOrder: false }).errors).toEqual([
      "Enter a refund above $0.00.",
      "Enter the reason."
    ]);
    expect(checkRefund(current, { amount: "ten", reason: "x", cancelOrder: false })).toEqual({
      errors: ["Enter the refund as an amount, for example 12.00."],
      input: null
    });
    // An order that the customer has cannot be canceled.
    const done = order({ state: "handed_over" });
    expect(checkRefund(done, { amount: "5", reason: "Late", cancelOrder: true }).input?.cancelOrder).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POS sales
// ---------------------------------------------------------------------------

function sale(overrides: Partial<SaleFields> = {}): SaleFields {
  return {
    id: "s1",
    ticketNumber: "POS-1",
    items: [
      { productId: "red", productName: "Red", quantity: 2, unitPriceCents: 400 },
      { productId: "green", productName: "Green", quantity: 1, unitPriceCents: 400 }
    ],
    taxCents: 104,
    totalCents: 1304,
    paymentMethod: "cash",
    customerName: "",
    isTest: false,
    status: "paid",
    source: "pos",
    ...overrides
  };
}

describe("POS sales: no deletes and no silent edits", () => {
  it("offers Edit and Void for a real sale, and never a delete", () => {
    expect(saleActions(sale())).toEqual({ readOnly: false, edit: true, void: true, restore: false, remove: false });
    expect(saleActions(sale({ status: "void" }))).toEqual({
      readOnly: false,
      edit: false,
      void: false,
      restore: false,
      remove: false
    });
  });

  it("keeps Restore and Delete for a test sale", () => {
    expect(saleActions(sale({ isTest: true }))).toMatchObject({ edit: true, void: true, restore: false, remove: true });
    expect(saleActions(sale({ isTest: true, status: "void" }))).toMatchObject({ restore: true, remove: true });
  });

  it("makes a sale from an order read-only", () => {
    expect(saleActions(sale({ source: "order" }))).toEqual({
      readOnly: true,
      edit: false,
      void: false,
      restore: false,
      remove: false
    });
  });

  it("requires a reason for a real sale", () => {
    expect(reasonError(" ", false)).toBe("Enter the reason.");
    expect(reasonError("", true)).toBe("");
    expect(reasonError("Wrong item", false)).toBe("");
    expect(reasonError("x".repeat(301), false)).toBe("Make the reason 300 characters or shorter.");
  });

  it("builds the void entry from the sale total and tax", () => {
    expect(voidLedgerFields(sale(), " Rang twice ")).toEqual({
      type: "void",
      saleId: "s1",
      orderId: "",
      reference: "POS-1",
      amountCents: 1304,
      taxCents: 104,
      reason: "Rang twice",
      detail: ""
    });
  });

  it("builds the edit entry from the change", () => {
    const change = {
      items: [{ productId: "red", productName: "Red", quantity: 2, unitPriceCents: 400 }],
      taxCents: 70,
      totalCents: 870,
      paymentMethod: "venmo",
      customerName: "Maria"
    };
    expect(saleChanged(sale(), change)).toBe(true);
    expect(editLedgerFields(sale(), change, "1 less")).toEqual({
      type: "edit",
      saleId: "s1",
      orderId: "",
      reference: "POS-1",
      amountCents: -434,
      taxCents: -34,
      reason: "1 less",
      detail:
        "Total $13.04 to $8.70. Items: 2 × Red, 1 × Green to 2 × Red. Payment: Cash to Venmo. Name: none to Maria."
    });
  });

  it("labels the method of a sale from an order", () => {
    expect(posPaymentLabel("paypal")).toBe("PayPal");
    expect(posPaymentLabel("cashapp")).toBe("Cash App");
    expect(posPaymentLabel("unset")).toBe("Not recorded");
    expect(posPaymentLabel("zelle")).toBe("zelle");
  });

  it("sees a sale with no change", () => {
    const same = { ...sale(), customerName: " " };
    expect(editDetail(sale(), same)).toBe("");
    expect(saleChanged(sale(), same)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function ticket(overrides: Partial<SaleRecord> = {}): SaleRecord {
  return {
    id: "s1",
    status: "paid",
    isTest: false,
    createdAtUtc: "2026-11-05T18:00:00.000Z",
    subtotalCents: 1000,
    taxCents: 87,
    orderId: "",
    deliveryFeeCents: 0,
    onlineFeeCents: 0,
    paypalFeeCents: 0,
    ...overrides
  };
}

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "e1",
    type: "refund",
    saleId: "",
    orderId: "",
    reference: "BBT-1042",
    amountCents: 0,
    taxCents: 0,
    reason: "Reason",
    detail: "",
    byEmail: "owner@example.com",
    isTest: false,
    createdAtUtc: "2026-11-06T18:00:00.000Z",
    ...overrides
  };
}

const november: Period = { id: "this_month", label: "This month", startKey: "2026-11-01", endKey: "2026-11-30" };
const reporting = {
  revenueShareBps: 1000,
  taxJurisdiction: "",
  taxAccountNumber: "",
  filingFrequency: "quarterly" as const,
  cashOnHandCents: 50000,
  equipmentAssetsCents: 0,
  otherAssetsCents: 0,
  otherLiabilitiesCents: 0,
  taxRemittedToDateCents: 100,
  adminSharePaidToDateCents: 0
};

describe("report sales", () => {
  it("keeps test sales out", () => {
    expect(reportSales([ticket({ isTest: true })], [], dayKeyOf)).toEqual([]);
  });

  it("counts a voided sale only when it has a void entry", () => {
    const voided = ticket({ status: "void" });
    expect(reportSales([voided], [], dayKeyOf)).toEqual([]);
    const withEntry = reportSales([voided], [entry({ type: "void", saleId: "s1", amountCents: 1087, taxCents: 87 })], dayKeyOf);
    expect(withEntry).toHaveLength(1);
    expect(withEntry[0]).toMatchObject({ dateKey: "2026-11-05", subtotalCents: 1000, taxCents: 87 });
  });

  it("shows an edited sale as it was first recorded", () => {
    // The sale now holds $6.00 + $0.52. The edit took off $4.00 + $0.35.
    const edited = ticket({ subtotalCents: 600, taxCents: 52 });
    const edit = entry({ type: "edit", saleId: "s1", amountCents: -435, taxCents: -35 });
    expect(reportSales([edited], [edit], dayKeyOf)[0]).toMatchObject({ subtotalCents: 1000, taxCents: 87 });
    // A test entry changes nothing.
    expect(reportSales([edited], [{ ...edit, isTest: true }], dayKeyOf)[0]).toMatchObject({ subtotalCents: 600 });
  });
});

describe("ledger adjustments", () => {
  it("makes a void and an edit count on the day of the entry", () => {
    const list = ledgerAdjustments(
      [
        entry({ id: "v", type: "void", saleId: "s1", amountCents: 1087, taxCents: 87 }),
        entry({ id: "ed", type: "edit", saleId: "s2", amountCents: -435, taxCents: -35 }),
        entry({ id: "up", type: "edit", saleId: "s2", amountCents: 435, taxCents: 35 })
      ],
      [],
      dayKeyOf
    );
    expect(list).toEqual([
      { entryId: "v", dateKey: "2026-11-06", netCents: -1000, taxCents: -87 },
      { entryId: "ed", dateKey: "2026-11-06", netCents: -400, taxCents: -35 },
      { entryId: "up", dateKey: "2026-11-06", netCents: 400, taxCents: 35 }
    ]);
  });

  it("counts a refund only when its order is a sale", () => {
    const refund = entry({ orderId: "o1", amountCents: 544, taxCents: 44 });
    // Not handed over: the refund returns a deposit.
    expect(ledgerAdjustments([refund], [], dayKeyOf)).toEqual([]);
    // Handed over later: the refund counts on the day of the sale.
    const later = ticket({ id: "s9", orderId: "o1", createdAtUtc: "2026-12-02T18:00:00.000Z" });
    expect(ledgerAdjustments([refund], [later], dayKeyOf)).toEqual([
      { entryId: "e1", dateKey: "2026-12-02", netCents: -500, taxCents: -44 }
    ]);
    // Refund after the handover: it counts on the day of the refund.
    const after = entry({ saleId: "s9", orderId: "o1", amountCents: 544, taxCents: 44, createdAtUtc: "2026-12-09T18:00:00.000Z" });
    expect(ledgerAdjustments([after], [later], dayKeyOf)[0].dateKey).toBe("2026-12-09");
  });

  it("keeps test entries out", () => {
    expect(ledgerAdjustments([entry({ type: "void", saleId: "s1", amountCents: 100, isTest: true })], [], dayKeyOf)).toEqual([]);
  });
});

describe("statements", () => {
  const tickets: SaleRecord[] = [
    ticket({ id: "pos1" }),
    ticket({ id: "pos2", status: "void" }),
    ticket({
      id: "ord1",
      orderId: "o1",
      subtotalCents: 3600,
      taxCents: 313,
      deliveryFeeCents: 800,
      onlineFeeCents: 107,
      paypalFeeCents: 217
    }),
    ticket({ id: "old", createdAtUtc: "2026-10-20T18:00:00.000Z", subtotalCents: 2000, taxCents: 174 }),
    ticket({ id: "practice", isTest: true, subtotalCents: 99999 })
  ];
  const entries: LedgerEntry[] = [
    entry({ id: "v", type: "void", saleId: "pos2", amountCents: 1087, taxCents: 87 }),
    entry({ id: "r", type: "refund", saleId: "ord1", orderId: "o1", amountCents: 544, taxCents: 44 }),
    entry({ id: "dep", type: "refund", orderId: "o2", amountCents: 4000, taxCents: 320 })
  ];
  const sales = reportSales(tickets, entries, dayKeyOf);
  const adjustments = ledgerAdjustments(entries, tickets, dayKeyOf);
  const periodSales = inPeriodByKey(sales, november);
  const periodAdjustments = inPeriodByKey(adjustments, november);

  it("builds the income statement of the period", () => {
    const statement = buildIncomeStatement(
      periodSales,
      periodAdjustments,
      [
        { category: "ingredients", amountCents: 1200 },
        { category: "ingredients", amountCents: 300 }
      ],
      reporting
    );
    expect(statement).toEqual({
      // 1000 + 1000 (voided, with its entry) + 3600
      grossSalesCents: 5600,
      // void -1000, refund -500. The deposit refund is not a change to sales.
      adjustmentsCents: -1500,
      netSalesCents: 4100,
      deliveryFeesCents: 800,
      onlineFeesCents: 107,
      totalIncomeCents: 5007,
      expenseLines: [{ category: "ingredients", label: "Ingredients / food cost", amountCents: 1500 }],
      paymentFeesCents: 217,
      adminShareCents: 410,
      totalExpensesCents: 2127,
      netIncomeCents: 2880
    });
  });

  it("builds the sales tax report of the period", () => {
    expect(buildSalesTaxReport(periodSales, periodAdjustments, 870)).toEqual({
      netSalesCents: 4100,
      taxRateBps: 870,
      taxCollectedCents: 487,
      taxAdjustmentsCents: -131,
      taxDueCents: 356
    });
  });

  it("counts customer deposits from paid orders that are not handed over", () => {
    const orders = [
      order({ state: "received" }),
      order({ state: "ready", refundedCents: 1006 }),
      order({ state: "handed_over" }),
      order({ state: "canceled" }),
      order({ state: "approved", paymentState: "unpaid" }),
      order({ state: "received", paymentState: "refunded", refundedCents: 4006 }),
      order({ state: "received", paymentState: "check_payment" })
    ];
    expect(customerDepositsCents(orders)).toBe(4006 + 3000);
  });

  it("builds the balance sheet from all sales", () => {
    const sheet = buildBalanceSheet(sales, adjustments, [order({ state: "received" })], reporting, "2026-11-15");
    expect(sheet).toEqual({
      asOfKey: "2026-11-15",
      cashOnHandCents: 50000,
      equipmentAssetsCents: 0,
      otherAssetsCents: 0,
      totalAssetsCents: 50000,
      // 487 + 174 collected, less 131 in the void and the refund, less 100 remitted
      salesTaxPayableCents: 430,
      customerDepositsCents: 4006,
      // 10% of (5600 + 2000 - 1500)
      adminSharePayableCents: 610,
      otherLiabilitiesCents: 0,
      totalLiabilitiesCents: 5046,
      ownerEquityCents: 44954
    });
  });

  it("lists the entries of the period, newest first", () => {
    const list = ledgerEntriesInPeriod(
      [
        entry({ id: "a", createdAtUtc: "2026-11-02T10:00:00.000Z" }),
        entry({ id: "b", createdAtUtc: "2026-11-20T10:00:00.000Z" }),
        entry({ id: "c", createdAtUtc: "2026-10-31T10:00:00.000Z" }),
        entry({ id: "d", createdAtUtc: "2026-11-21T10:00:00.000Z", isTest: true })
      ],
      november,
      dayKeyOf
    );
    expect(list.map((item) => item.id)).toEqual(["b", "a"]);
  });

  it("shows the amount of an entry", () => {
    expect(ledgerAmountText({ type: "refund", amountCents: 544 }, money)).toBe("$5.44");
    expect(ledgerAmountText({ type: "void", amountCents: 1087 }, money)).toBe("$10.87");
    expect(ledgerAmountText({ type: "edit", amountCents: -435 }, money)).toBe("-$4.35");
    expect(ledgerAmountText({ type: "edit", amountCents: 200 }, money)).toBe("+$2.00");
    expect(ledgerAmountText({ type: "edit", amountCents: 0 }, money)).toBe("$0.00");
  });
});
