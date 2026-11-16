// Admin > Reports: the income statement, the balance sheet, the sales tax report,
// and the list of refunds and voids. The numbers come from src/lib/reports.ts.

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { LedgerEntry } from "../../../shared/moneyModel";
import { downloadCsv } from "../../lib/csv";
import { watchLedgerEntries, type ReportingSettings } from "../../lib/firestoreClient";
import { formatMoney } from "../../lib/money";
import {
  ledgerAmountText,
  ledgerTypeLabels,
  periodRangeLabel,
  type BalanceSheet,
  type IncomeStatement,
  type Period,
  type SalesTaxReport
} from "../../lib/reports";
import { businessTodayKey, formatBusinessDateTime } from "../../lib/time";

const dollars = (cents: number) => (cents / 100).toFixed(2);

export interface LedgerState {
  entries: LedgerEntry[];
  failed: boolean;
}

/** `ledgerEntries`, live. Owner only. */
export function useLedgerEntries(): LedgerState {
  const [state, setState] = useState<LedgerState>({ entries: [], failed: false });
  useEffect(
    () =>
      watchLedgerEntries(
        (entries) => setState({ entries, failed: false }),
        () => setState((current) => ({ ...current, failed: true }))
      ),
    []
  );
  return state;
}

interface ReportLineProps {
  label: string;
  cents: number;
  indent?: boolean;
  total?: boolean;
}

/** One money line. A negative amount shows in parentheses. */
function ReportLine({ label, cents, indent = false, total = false }: ReportLineProps) {
  return (
    <div className={`report-line${indent ? " indent" : ""}${total ? " total" : ""}`}>
      <span>{label}</span>
      <strong>{cents < 0 ? `(${formatMoney(-cents)})` : formatMoney(cents)}</strong>
    </div>
  );
}

function sharePercent(reporting: ReportingSettings): number {
  return reporting.revenueShareBps / 100;
}

interface IncomeStatementCardProps {
  businessName: string;
  period: Period;
  statement: IncomeStatement;
  reporting: ReportingSettings;
}

export function IncomeStatementCard({ businessName, period, statement, reporting }: IncomeStatementCardProps) {
  const shareLabel = `Revenue share (${sharePercent(reporting)}% of net sales)`;

  function download() {
    const rows: string[][] = [
      [businessName, ""],
      ["Income Statement", periodRangeLabel(period)],
      ["", ""],
      ["Gross sales", dollars(statement.grossSalesCents)],
      ["Refunds, voids and edits", dollars(statement.adjustmentsCents)],
      ["Net sales", dollars(statement.netSalesCents)],
      ["Delivery fees", dollars(statement.deliveryFeesCents)],
      ["Online ordering fees", dollars(statement.onlineFeesCents)],
      ["Total income", dollars(statement.totalIncomeCents)],
      ["", ""],
      ...statement.expenseLines.map((line) => [line.label, dollars(line.amountCents)]),
      ["Payment fees", dollars(statement.paymentFeesCents)],
      [shareLabel, dollars(statement.adminShareCents)],
      ["Total expenses", dollars(statement.totalExpensesCents)],
      ["", ""],
      ["Net income", dollars(statement.netIncomeCents)]
    ];
    downloadCsv(`bbt-income-statement-${period.id}-${businessTodayKey()}.csv`, rows);
  }

  return (
    <article className="admin-card report-card">
      <header className="report-heading">
        <p className="eyebrow">{businessName}</p>
        <h2>Income Statement</h2>
        <p className="muted">{periodRangeLabel(period)}</p>
      </header>
      <h3 className="report-subhead">Income</h3>
      <div className="report-lines">
        <ReportLine label="Gross sales" cents={statement.grossSalesCents} indent />
        <ReportLine label="Refunds, voids and edits" cents={statement.adjustmentsCents} indent />
        <ReportLine label="Net sales" cents={statement.netSalesCents} total />
        <ReportLine label="Delivery fees" cents={statement.deliveryFeesCents} indent />
        <ReportLine label="Online ordering fees" cents={statement.onlineFeesCents} indent />
        <ReportLine label="Total income" cents={statement.totalIncomeCents} total />
      </div>
      <h3 className="report-subhead">Expenses</h3>
      <div className="report-lines">
        {statement.expenseLines.map((line) => (
          <ReportLine key={line.category} label={line.label} cents={line.amountCents} indent />
        ))}
        <ReportLine label="Payment fees" cents={statement.paymentFeesCents} indent />
        <ReportLine label={shareLabel} cents={statement.adminShareCents} indent />
        <ReportLine label="Total expenses" cents={statement.totalExpensesCents} total />
        <ReportLine label="Net income" cents={statement.netIncomeCents} total />
      </div>
      <button className="button button-primary" type="button" onClick={download}>
        <Download size={18} aria-hidden="true" />
        Download CSV
      </button>
    </article>
  );
}

interface BalanceSheetCardProps {
  businessName: string;
  sheet: BalanceSheet;
}

export function BalanceSheetCard({ businessName, sheet }: BalanceSheetCardProps) {
  function download() {
    const rows: string[][] = [
      [businessName, ""],
      ["Balance Sheet", `As of ${sheet.asOfKey}`],
      ["", ""],
      ["Assets", ""],
      ["Cash on hand", dollars(sheet.cashOnHandCents)],
      ["Equipment", dollars(sheet.equipmentAssetsCents)],
      ["Other assets", dollars(sheet.otherAssetsCents)],
      ["Total assets", dollars(sheet.totalAssetsCents)],
      ["", ""],
      ["Liabilities", ""],
      ["Sales tax payable", dollars(sheet.salesTaxPayableCents)],
      ["Customer deposits", dollars(sheet.customerDepositsCents)],
      ["Revenue share payable", dollars(sheet.adminSharePayableCents)],
      ["Other liabilities", dollars(sheet.otherLiabilitiesCents)],
      ["Total liabilities", dollars(sheet.totalLiabilitiesCents)],
      ["", ""],
      ["Owner's equity", dollars(sheet.ownerEquityCents)]
    ];
    downloadCsv(`bbt-balance-sheet-${sheet.asOfKey}.csv`, rows);
  }

  return (
    <article className="admin-card report-card">
      <header className="report-heading">
        <p className="eyebrow">{businessName}</p>
        <h2>Balance Sheet</h2>
        <p className="muted">As of {sheet.asOfKey}</p>
      </header>
      <h3 className="report-subhead">Assets</h3>
      <div className="report-lines">
        <ReportLine label="Cash on hand" cents={sheet.cashOnHandCents} indent />
        <ReportLine label="Equipment" cents={sheet.equipmentAssetsCents} indent />
        <ReportLine label="Other assets" cents={sheet.otherAssetsCents} indent />
        <ReportLine label="Total assets" cents={sheet.totalAssetsCents} total />
      </div>
      <h3 className="report-subhead">Liabilities</h3>
      <div className="report-lines">
        <ReportLine label="Sales tax payable" cents={sheet.salesTaxPayableCents} indent />
        <ReportLine label="Customer deposits" cents={sheet.customerDepositsCents} indent />
        <ReportLine label="Revenue share payable" cents={sheet.adminSharePayableCents} indent />
        <ReportLine label="Other liabilities" cents={sheet.otherLiabilitiesCents} indent />
        <ReportLine label="Total liabilities" cents={sheet.totalLiabilitiesCents} total />
      </div>
      <div className="report-lines">
        <ReportLine label="Owner's equity" cents={sheet.ownerEquityCents} total />
      </div>
      <p className="muted">
        Customer deposits are paid orders that are not handed over. Asset values come from Report Settings.
      </p>
      <button className="button button-primary" type="button" onClick={download}>
        <Download size={18} aria-hidden="true" />
        Download CSV
      </button>
    </article>
  );
}

interface SalesTaxCardProps {
  businessName: string;
  period: Period;
  report: SalesTaxReport;
  reporting: ReportingSettings;
}

export function SalesTaxCard({ businessName, period, report, reporting }: SalesTaxCardProps) {
  const notSet = "Set in Report Settings";

  function download() {
    const rows: string[][] = [
      [businessName, ""],
      ["Sales Tax Report", periodRangeLabel(period)],
      ["Jurisdiction", reporting.taxJurisdiction],
      ["Tax account number", reporting.taxAccountNumber],
      ["Filing frequency", reporting.filingFrequency],
      ["", ""],
      ["Net sales", dollars(report.netSalesCents)],
      ["Tax rate", `${report.taxRateBps / 100}%`],
      ["Tax collected", dollars(report.taxCollectedCents)],
      ["Tax in refunds, voids and edits", dollars(report.taxAdjustmentsCents)],
      ["Tax due", dollars(report.taxDueCents)]
    ];
    downloadCsv(`bbt-sales-tax-${period.id}-${businessTodayKey()}.csv`, rows);
  }

  return (
    <article className="admin-card report-card">
      <header className="report-heading">
        <p className="eyebrow">{businessName}</p>
        <h2>Sales Tax Report</h2>
        <p className="muted">{periodRangeLabel(period)}</p>
      </header>
      <div className="report-lines">
        <div className="report-line">
          <span>Jurisdiction</span>
          <strong>{reporting.taxJurisdiction || notSet}</strong>
        </div>
        <div className="report-line">
          <span>Tax account number</span>
          <strong>{reporting.taxAccountNumber || notSet}</strong>
        </div>
        <div className="report-line">
          <span>Filing frequency</span>
          <strong>{reporting.filingFrequency}</strong>
        </div>
      </div>
      <div className="report-lines">
        <ReportLine label="Net sales" cents={report.netSalesCents} indent />
        <div className="report-line indent">
          <span>Tax rate</span>
          <strong>{report.taxRateBps / 100}%</strong>
        </div>
        <ReportLine label="Tax collected" cents={report.taxCollectedCents} indent />
        <ReportLine label="Tax in refunds, voids and edits" cents={report.taxAdjustmentsCents} indent />
        <ReportLine label="Tax due" cents={report.taxDueCents} total />
      </div>
      <button className="button button-primary" type="button" onClick={download}>
        <Download size={18} aria-hidden="true" />
        Download CSV
      </button>
    </article>
  );
}

interface LedgerCardProps {
  period: Period;
  /** The entries of the period, newest first. */
  entries: LedgerEntry[];
  failed: boolean;
}

/** Refunds and voids: each ledger entry of the period, with the reason and the person. */
export function LedgerCard({ period, entries, failed }: LedgerCardProps) {
  function download() {
    const header = ["Date", "Reference", "Type", "Amount", "Tax part", "Reason", "Change", "By"];
    const rows = entries.map((entry) => [
      formatBusinessDateTime(entry.createdAtUtc),
      entry.reference,
      ledgerTypeLabels[entry.type],
      dollars(entry.amountCents),
      dollars(entry.taxCents),
      entry.reason,
      entry.detail,
      entry.byEmail
    ]);
    downloadCsv(`bbt-refunds-voids-${period.id}-${businessTodayKey()}.csv`, [header, ...rows]);
  }

  return (
    <article className="admin-card report-card">
      <header className="report-heading">
        <h2>Refunds and Voids</h2>
        <p className="muted">{periodRangeLabel(period)}</p>
      </header>
      {failed && (
        <p className="form-notice form-notice-error" role="alert">
          We could not load the refunds and voids. Check your connection, then reload the page.
        </p>
      )}
      {!failed && entries.length === 0 && <p className="muted">No refunds or voids are in this period.</p>}
      {entries.length > 0 && (
        <ul className="ledger-list">
          {entries.map((entry) => (
            <li className="ledger-row" key={entry.id}>
              <div className="ledger-row-head">
                <strong>{entry.reference}</strong>
                <span className="status-badge status-canceled">{ledgerTypeLabels[entry.type]}</span>
                <strong className="ledger-row-amount">{ledgerAmountText(entry, formatMoney)}</strong>
              </div>
              <span className="muted">
                {formatBusinessDateTime(entry.createdAtUtc)}
                {entry.byEmail && ` · ${entry.byEmail}`}
              </span>
              {entry.reason && <span>{entry.reason}</span>}
              {entry.detail && <span className="muted">{entry.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <button className="button button-primary" type="button" onClick={download} disabled={entries.length === 0}>
        <Download size={18} aria-hidden="true" />
        Download CSV
      </button>
    </article>
  );
}
