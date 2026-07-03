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

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  ingredients: "Ingredients / food cost",
  supplies: "Supplies",
  packaging: "Packaging",
  equipment: "Equipment",
  fees: "Fees & processing",
  marketing: "Marketing",
  other: "Other expenses"
};

export interface IncomeStatement {
  grossReceiptsCents: number;
  salesTaxCents: number;
  netSalesCents: number;
  adminShareCents: number;
  expenseLines: { category: ExpenseCategory; label: string; amountCents: number }[];
  operatingExpensesCents: number;
  totalExpensesCents: number;
  ownerNetIncomeCents: number;
}

function sumTax(tickets: PosTicketRecord[]) {
  return tickets.reduce((sum, ticket) => sum + ticket.taxCents, 0);
}

function sumTotal(tickets: PosTicketRecord[]) {
  return tickets.reduce((sum, ticket) => sum + ticket.totalCents, 0);
}

export function adminShareOfNetSales(netSalesCents: number, reporting: ReportingSettings) {
  return Math.round((netSalesCents * reporting.revenueShareBps) / 10000);
}

export function buildIncomeStatement(
  tickets: PosTicketRecord[],
  expenses: ExpenseRecord[],
  reporting: ReportingSettings
): IncomeStatement {
  const grossReceiptsCents = sumTotal(tickets);
  const salesTaxCents = sumTax(tickets);
  const netSalesCents = grossReceiptsCents - salesTaxCents;
  const adminShareCents = adminShareOfNetSales(netSalesCents, reporting);

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
  const operatingExpensesCents = expenseLines.reduce((sum, line) => sum + line.amountCents, 0);
  const totalExpensesCents = operatingExpensesCents + adminShareCents;

  return {
    grossReceiptsCents,
    salesTaxCents,
    netSalesCents,
    adminShareCents,
    expenseLines,
    operatingExpensesCents,
    totalExpensesCents,
    ownerNetIncomeCents: netSalesCents - totalExpensesCents
  };
}

export interface SalesTaxReport {
  grossSalesCents: number;
  exemptSalesCents: number;
  taxableSalesCents: number;
  taxRateBps: number;
  taxCalculatedCents: number;
  taxCollectedCents: number;
  roundingDifferenceCents: number;
}

export function buildSalesTaxReport(
  tickets: PosTicketRecord[],
  taxRateBps: number
): SalesTaxReport {
  const taxCollectedCents = sumTax(tickets);
  const grossSalesCents = sumTotal(tickets) - taxCollectedCents;
  const taxableSalesCents = grossSalesCents;
  const taxCalculatedCents = Math.round((taxableSalesCents * taxRateBps) / 10000);
  return {
    grossSalesCents,
    exemptSalesCents: 0,
    taxableSalesCents,
    taxRateBps,
    taxCalculatedCents,
    taxCollectedCents,
    roundingDifferenceCents: taxCollectedCents - taxCalculatedCents
  };
}

export interface BalanceSheet {
  asOfKey: string;
  cashOnHandCents: number;
  equipmentAssetsCents: number;
  otherAssetsCents: number;
  totalAssetsCents: number;
  salesTaxPayableCents: number;
  adminSharePayableCents: number;
  otherLiabilitiesCents: number;
  totalLiabilitiesCents: number;
  ownerEquityCents: number;
}

/**
 * A simplified small-business balance sheet: asset values come from the
 * reporting settings, while the two operating liabilities are derived from
 * all-time POS activity minus what has already been remitted/paid out.
 */
export function buildBalanceSheet(
  allTimeTickets: PosTicketRecord[],
  reporting: ReportingSettings
): BalanceSheet {
  const allTimeTax = sumTax(allTimeTickets);
  const allTimeNetSales = sumTotal(allTimeTickets) - allTimeTax;
  const salesTaxPayableCents = allTimeTax - reporting.taxRemittedToDateCents;
  const adminSharePayableCents =
    adminShareOfNetSales(allTimeNetSales, reporting) - reporting.adminSharePaidToDateCents;
  const totalAssetsCents =
    reporting.cashOnHandCents + reporting.equipmentAssetsCents + reporting.otherAssetsCents;
  const totalLiabilitiesCents =
    salesTaxPayableCents + adminSharePayableCents + reporting.otherLiabilitiesCents;
  return {
    asOfKey: businessTodayKey(),
    cashOnHandCents: reporting.cashOnHandCents,
    equipmentAssetsCents: reporting.equipmentAssetsCents,
    otherAssetsCents: reporting.otherAssetsCents,
    totalAssetsCents,
    salesTaxPayableCents,
    adminSharePayableCents,
    otherLiabilitiesCents: reporting.otherLiabilitiesCents,
    totalLiabilitiesCents,
    ownerEquityCents: totalAssetsCents - totalLiabilitiesCents
  };
}
