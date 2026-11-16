import type { OrderRecord } from "../../shared/model";
import type { LedgerEntry } from "../../shared/moneyModel";
import type {
  ExpenseCategory,
  ExpenseRecord,
  PosTicketRecord,
  ReportingSettings
} from "./firestoreClient";
import { businessDateKey, businessTodayKey } from "./time";

// ---------------------------------------------------------------------------
// Reporting periods. Day keys are YYYY-MM-DD strings in the business timezone,
// so string comparison doubles as date comparison.
// ---------------------------------------------------------------------------

export type PeriodId =
  | "today"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "ytd"
  | "all";

export interface Period {
  id: PeriodId;
  label: string;
  /** Inclusive bounds; null means unbounded. */
  startKey: string | null;
  endKey: string | null;
}

const pad = (value: number) => String(value).padStart(2, "0");

function monthKey(year: number, month: number, day: number) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function getPeriods(): Period[] {
  const todayKey = businessTodayKey();
  const [year, month] = todayKey.split("-").map(Number);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  const lastMonthYear = month === 1 ? year - 1 : year;
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastQuarterStartMonth = quarterStartMonth === 1 ? 10 : quarterStartMonth - 3;
  const lastQuarterYear = quarterStartMonth === 1 ? year - 1 : year;
  const lastQuarterEndMonth = lastQuarterStartMonth + 2;

  return [
    { id: "today", label: "Today", startKey: todayKey, endKey: todayKey },
    {
      id: "this_month",
      label: "This month",
      startKey: monthKey(year, month, 1),
      endKey: todayKey
    },
    {
      id: "last_month",
      label: "Last month",
      startKey: monthKey(lastMonthYear, lastMonth, 1),
      endKey: monthKey(lastMonthYear, lastMonth, lastDayOfMonth(lastMonthYear, lastMonth))
    },
    {
      id: "this_quarter",
      label: "This quarter",
      startKey: monthKey(year, quarterStartMonth, 1),
      endKey: todayKey
    },
    {
      id: "last_quarter",
      label: "Last quarter",
      startKey: monthKey(lastQuarterYear, lastQuarterStartMonth, 1),
      endKey: monthKey(
        lastQuarterYear,
        lastQuarterEndMonth,
        lastDayOfMonth(lastQuarterYear, lastQuarterEndMonth)
      )
    },
    { id: "ytd", label: "Year to date", startKey: monthKey(year, 1, 1), endKey: todayKey },
    { id: "all", label: "All time", startKey: null, endKey: null }
  ];
}

export function inPeriod(dateKey: string, period: Period): boolean {
  if (period.startKey && dateKey < period.startKey) return false;
  if (period.endKey && dateKey > period.endKey) return false;
  return true;
}

export function periodRangeLabel(period: Period): string {
  if (!period.startKey) return "All activity to date";
  if (period.startKey === period.endKey) return period.startKey;
  return `${period.startKey} through ${period.endKey}`;
}

export function ticketsInPeriod(tickets: PosTicketRecord[], period: Period): PosTicketRecord[] {
  return tickets.filter((ticket) => inPeriod(businessDateKey(ticket.createdAtUtc), period));
}

export function expensesInPeriod(expenses: ExpenseRecord[], period: Period): ExpenseRecord[] {
  return expenses.filter((expense) => inPeriod(expense.dateKey, period));
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------
// The rules are in docs/V1_FUNDAMENTALS.md section 12:
// - `posTickets` is the 1 sales ledger. A POS sale and a handed-over order are both sales.
// - A refund, a void and an edit are entries in `ledgerEntries`. A sale counts as it was
//   first recorded, in the period of the sale. Each entry counts in its own period.
// - A prepayment is a liability until handover. Collected tax is a liability. A fee is an expense.
// - Test data stays out of each number.
// All functions below are pure. `dayKeyOf` gives the business day (YYYY-MM-DD) of a UTC time.

export type DayKeyOf = (iso: string) => string;

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  ingredients: "Ingredients / food cost",
  supplies: "Supplies",
  packaging: "Packaging",
  equipment: "Equipment",
  fees: "Fees & processing",
  marketing: "Marketing",
  other: "Other expenses"
};

/** The parts of a sale that the reports read. `PosTicketRecord` fits it. */
export type SaleRecord = Pick<
  PosTicketRecord,
  | "id"
  | "status"
  | "isTest"
  | "createdAtUtc"
  | "subtotalCents"
  | "taxCents"
  | "orderId"
  | "deliveryFeeCents"
  | "onlineFeeCents"
  | "paypalFeeCents"
>;

/** A sale as it was first recorded, before each edit. */
export interface ReportSale {
  id: string;
  dateKey: string;
  subtotalCents: number;
  taxCents: number;
  deliveryFeeCents: number;
  onlineFeeCents: number;
  paypalFeeCents: number;
}

/** The effect of 1 ledger entry on sales. A refund and a void are negative. An edit has the sign of its change. */
export interface LedgerAdjustment {
  entryId: string;
  dateKey: string;
  /** The change to sales without tax. */
  netCents: number;
  /** The change to collected tax. */
  taxCents: number;
}

function realEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return entries.filter((entry) => !entry.isTest);
}

/**
 * The sales for the reports: each real sale that is paid, and each voided sale that has a
 * void entry. The amounts are the first recorded amounts: an edit entry holds each later change.
 */
export function reportSales(tickets: SaleRecord[], entries: LedgerEntry[], dayKeyOf: DayKeyOf = businessDateKey): ReportSale[] {
  const real = realEntries(entries);
  const voided = new Set(real.filter((entry) => entry.type === "void").map((entry) => entry.saleId));
  const sales: ReportSale[] = [];
  for (const ticket of tickets) {
    if (ticket.isTest) continue;
    if (ticket.status !== "paid" && !voided.has(ticket.id)) continue;
    let subtotalCents = ticket.subtotalCents;
    let taxCents = ticket.taxCents;
    for (const entry of real) {
      if (entry.type !== "edit" || entry.saleId !== ticket.id) continue;
      subtotalCents -= entry.amountCents - entry.taxCents;
      taxCents -= entry.taxCents;
    }
    sales.push({
      id: ticket.id,
      dateKey: dayKeyOf(ticket.createdAtUtc),
      subtotalCents,
      taxCents,
      deliveryFeeCents: ticket.deliveryFeeCents,
      onlineFeeCents: ticket.onlineFeeCents,
      paypalFeeCents: ticket.paypalFeeCents
    });
  }
  return sales;
}

/**
 * The entries that change sales.
 * - A void and an edit count on the day of the entry.
 * - A refund counts only when its order is a sale (it was handed over). It counts on the day
 *   of the refund, or on the day of the sale if the sale is later. A refund of an order that
 *   was not handed over returns a deposit; it is not a change to sales.
 */
export function ledgerAdjustments(
  entries: LedgerEntry[],
  tickets: SaleRecord[],
  dayKeyOf: DayKeyOf = businessDateKey
): LedgerAdjustment[] {
  const adjustments: LedgerAdjustment[] = [];
  for (const entry of realEntries(entries)) {
    let at = entry.createdAtUtc;
    if (entry.type === "refund") {
      const sale = tickets.find(
        (ticket) =>
          !ticket.isTest &&
          ((entry.saleId !== "" && ticket.id === entry.saleId) ||
            (entry.orderId !== "" && ticket.orderId === entry.orderId))
      );
      if (!sale) continue;
      if (sale.createdAtUtc > at) at = sale.createdAtUtc;
    }
    const sign = entry.type === "edit" ? 1 : -1;
    adjustments.push({
      entryId: entry.id,
      dateKey: dayKeyOf(at),
      netCents: sign * (entry.amountCents - entry.taxCents),
      taxCents: sign * entry.taxCents
    });
  }
  return adjustments;
}

/** The items of a period. Each item has a `dateKey`. */
export function inPeriodByKey<T extends { dateKey: string }>(items: T[], period: Period): T[] {
  return items.filter((item) => inPeriod(item.dateKey, period));
}

/** The real ledger entries that were recorded in a period, newest first. For the "Refunds and voids" list. */
export function ledgerEntriesInPeriod(
  entries: LedgerEntry[],
  period: Period,
  dayKeyOf: DayKeyOf = businessDateKey
): LedgerEntry[] {
  return realEntries(entries)
    .filter((entry) => inPeriod(dayKeyOf(entry.createdAtUtc), period))
    .sort((a, b) => b.createdAtUtc.localeCompare(a.createdAtUtc));
}

const sum = <T,>(items: T[], pick: (item: T) => number) => items.reduce((total, item) => total + pick(item), 0);

export function adminShareOfNetSales(netSalesCents: number, reporting: Pick<ReportingSettings, "revenueShareBps">) {
  return Math.round((netSalesCents * reporting.revenueShareBps) / 10000);
}

export interface IncomeStatement {
  /** Subtotals of the sales of the period, POS sales and order sales together. No tax and no fees. */
  grossSalesCents: number;
  /** Refunds, voids and edits of the period, without their tax part. Negative when sales go down. */
  adjustmentsCents: number;
  netSalesCents: number;
  deliveryFeesCents: number;
  onlineFeesCents: number;
  totalIncomeCents: number;
  expenseLines: { category: ExpenseCategory; label: string; amountCents: number }[];
  /** What PayPal kept on the sales of the period. */
  paymentFeesCents: number;
  adminShareCents: number;
  totalExpensesCents: number;
  netIncomeCents: number;
}

/** The income statement of a period. Pass the sales, the adjustments and the expenses of that period. */
export function buildIncomeStatement(
  sales: ReportSale[],
  adjustments: LedgerAdjustment[],
  expenses: Pick<ExpenseRecord, "category" | "amountCents">[],
  reporting: Pick<ReportingSettings, "revenueShareBps">
): IncomeStatement {
  const grossSalesCents = sum(sales, (sale) => sale.subtotalCents);
  const adjustmentsCents = sum(adjustments, (item) => item.netCents);
  const netSalesCents = grossSalesCents + adjustmentsCents;
  const deliveryFeesCents = sum(sales, (sale) => sale.deliveryFeeCents);
  const onlineFeesCents = sum(sales, (sale) => sale.onlineFeeCents);
  const totalIncomeCents = netSalesCents + deliveryFeesCents + onlineFeesCents;

  const byCategory = new Map<ExpenseCategory, number>();
  for (const expense of expenses) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amountCents);
  }
  const expenseLines = (Object.keys(expenseCategoryLabels) as ExpenseCategory[])
    .filter((category) => (byCategory.get(category) ?? 0) !== 0)
    .map((category) => ({
      category,
      label: expenseCategoryLabels[category],
      amountCents: byCategory.get(category) ?? 0
    }));
  const paymentFeesCents = sum(sales, (sale) => sale.paypalFeeCents);
  const adminShareCents = adminShareOfNetSales(netSalesCents, reporting);
  const totalExpensesCents = sum(expenseLines, (line) => line.amountCents) + paymentFeesCents + adminShareCents;

  return {
    grossSalesCents,
    adjustmentsCents,
    netSalesCents,
    deliveryFeesCents,
    onlineFeesCents,
    totalIncomeCents,
    expenseLines,
    paymentFeesCents,
    adminShareCents,
    totalExpensesCents,
    netIncomeCents: totalIncomeCents - totalExpensesCents
  };
}

export interface SalesTaxReport {
  netSalesCents: number;
  taxRateBps: number;
  /** Tax on the sales of the period, as first recorded. */
  taxCollectedCents: number;
  /** The tax part of the refunds, voids and edits of the period. Negative when tax goes down. */
  taxAdjustmentsCents: number;
  taxDueCents: number;
}

/** The sales tax report of a period: tax collected, less the tax part of refunds, voids and edits. */
export function buildSalesTaxReport(
  sales: ReportSale[],
  adjustments: LedgerAdjustment[],
  taxRateBps: number
): SalesTaxReport {
  const taxCollectedCents = sum(sales, (sale) => sale.taxCents);
  const taxAdjustmentsCents = sum(adjustments, (item) => item.taxCents);
  return {
    netSalesCents: sum(sales, (sale) => sale.subtotalCents) + sum(adjustments, (item) => item.netCents),
    taxRateBps,
    taxCollectedCents,
    taxAdjustmentsCents,
    taxDueCents: taxCollectedCents + taxAdjustmentsCents
  };
}

/**
 * Customer deposits: the money of orders that are paid, not handed over and not stopped,
 * less what the owner refunded. A deposit is a liability until handover.
 */
export function customerDepositsCents(
  orders: Pick<OrderRecord, "state" | "paymentState" | "totals" | "refundedCents">[]
): number {
  return sum(orders, (order) => {
    if (order.paymentState !== "paid") return 0;
    if (order.state !== "received" && order.state !== "preparing" && order.state !== "ready") return 0;
    return Math.max(0, order.totals.totalCents - Math.max(0, order.refundedCents));
  });
}

export interface BalanceSheet {
  asOfKey: string;
  cashOnHandCents: number;
  equipmentAssetsCents: number;
  otherAssetsCents: number;
  totalAssetsCents: number;
  salesTaxPayableCents: number;
  customerDepositsCents: number;
  adminSharePayableCents: number;
  otherLiabilitiesCents: number;
  totalLiabilitiesCents: number;
  ownerEquityCents: number;
}

/**
 * A simple balance sheet. Asset values come from the report settings. Sales tax payable and
 * the revenue share payable come from all sales and all adjustments, less what is recorded as paid.
 */
export function buildBalanceSheet(
  allSales: ReportSale[],
  allAdjustments: LedgerAdjustment[],
  orders: Pick<OrderRecord, "state" | "paymentState" | "totals" | "refundedCents">[],
  reporting: ReportingSettings,
  asOfKey: string = businessTodayKey()
): BalanceSheet {
  const tax = buildSalesTaxReport(allSales, allAdjustments, 0);
  const salesTaxPayableCents = tax.taxDueCents - reporting.taxRemittedToDateCents;
  const adminSharePayableCents =
    adminShareOfNetSales(tax.netSalesCents, reporting) - reporting.adminSharePaidToDateCents;
  const depositsCents = customerDepositsCents(orders);
  const totalAssetsCents =
    reporting.cashOnHandCents + reporting.equipmentAssetsCents + reporting.otherAssetsCents;
  const totalLiabilitiesCents =
    salesTaxPayableCents + depositsCents + adminSharePayableCents + reporting.otherLiabilitiesCents;
  return {
    asOfKey,
    cashOnHandCents: reporting.cashOnHandCents,
    equipmentAssetsCents: reporting.equipmentAssetsCents,
    otherAssetsCents: reporting.otherAssetsCents,
    totalAssetsCents,
    salesTaxPayableCents,
    customerDepositsCents: depositsCents,
    adminSharePayableCents,
    otherLiabilitiesCents: reporting.otherLiabilitiesCents,
    totalLiabilitiesCents,
    ownerEquityCents: totalAssetsCents - totalLiabilitiesCents
  };
}

export const ledgerTypeLabels: Record<LedgerEntry["type"], string> = {
  refund: "Refund",
  void: "Void",
  edit: "Edit"
};

/** The amount of an entry as text. A refund and a void show the amount. An edit shows the signed change. */
export function ledgerAmountText(entry: Pick<LedgerEntry, "type" | "amountCents">, formatMoney: (cents: number) => string): string {
  if (entry.type !== "edit") return formatMoney(entry.amountCents);
  if (entry.amountCents === 0) return formatMoney(0);
  return `${entry.amountCents > 0 ? "+" : "-"}${formatMoney(Math.abs(entry.amountCents))}`;
}
