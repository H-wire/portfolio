import type {
  FmpBalanceSheetQuarter,
  FmpCashFlowQuarter,
  FmpFundamentalsResponse,
  FmpIncomeQuarter,
} from "./fmpTypes";

export type NormalizedFundamentals = {
  asOfDate: string;
  revenueTtm: number | null;
  epsTtm: number | null;
  ebitdaTtm: number | null;
  netIncomeTtm: number | null;
  incomeTaxExpenseTtm: number | null;
  operatingCashflowTtm: number | null;
  capitalExpenditureTtm: number | null;
  ebitTtm: number | null;
  taxRate: number | null;
  totalDebt: number | null;
  totalEquity: number | null;
  cashAndEquivalents: number | null;
  sharesOutstanding: number | null;
  raw: Record<string, unknown>;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : null;
}

function resolveDate(...dates: Array<string | undefined | null>) {
  for (const date of dates) {
    if (date) {
      return date;
    }
  }
  return new Date().toISOString().slice(0, 10);
}

function sumLast<T>(rows: T[], extractor: (row: T) => number | null, count = 4) {
  const slice = rows.slice(0, count);
  if (slice.length === 0) {
    return null;
  }
  let sum = 0;
  let hasValue = false;
  for (const row of slice) {
    const value = extractor(row);
    if (value !== null) {
      sum += value;
      hasValue = true;
    }
  }
  return hasValue ? sum : null;
}

function extractTaxRate(incomeRows: FmpIncomeQuarter[]) {
  const incomeTaxExpense = sumLast(incomeRows, (row) => toNumber(row.incomeTaxExpense ?? null));
  const netIncome = sumLast(incomeRows, (row) => toNumber(row.netIncome ?? null));
  if (incomeTaxExpense === null || netIncome === null) {
    return null;
  }
  const preTaxIncome = netIncome + incomeTaxExpense;
  if (preTaxIncome <= 0) {
    return null;
  }
  const rate = incomeTaxExpense / preTaxIncome;
  if (!Number.isFinite(rate)) {
    return null;
  }
  return Math.min(Math.max(rate, 0), 1);
}

function extractTotalDebt(balance: FmpBalanceSheetQuarter | null) {
  const totalDebt = toNumber(balance?.totalDebt ?? null);
  return totalDebt ?? null;
}

export function normalizeFmpFundamentals(response: FmpFundamentalsResponse): NormalizedFundamentals {
  const income = response.income ?? [];
  const cashflow = response.cashflow ?? [];
  const balance = response.balance;
  const asOfDate = resolveDate(income[0]?.date, cashflow[0]?.date, balance?.date);

  return {
    asOfDate,
    revenueTtm: sumLast(income, (row) => toNumber(row.revenue ?? null)),
    epsTtm: sumLast(income, (row) => toNumber(row.eps ?? null)),
    ebitdaTtm: sumLast(income, (row) => toNumber(row.ebitda ?? null)),
    netIncomeTtm: sumLast(income, (row) => toNumber(row.netIncome ?? null)),
    incomeTaxExpenseTtm: sumLast(income, (row) => toNumber(row.incomeTaxExpense ?? null)),
    operatingCashflowTtm: sumLast(cashflow, (row) => toNumber(row.operatingCashFlow ?? null)),
    capitalExpenditureTtm: sumLast(cashflow, (row) => toNumber(row.capitalExpenditure ?? null)),
    ebitTtm: sumLast(income, (row) => toNumber(row.ebit ?? null)),
    taxRate: extractTaxRate(income),
    totalDebt: extractTotalDebt(balance),
    totalEquity: toNumber(balance?.totalStockholdersEquity ?? null),
    cashAndEquivalents: toNumber(balance?.cashAndCashEquivalents ?? null),
    sharesOutstanding: toNumber(balance?.weightedAverageShsOut ?? null),
    raw: {
      income,
      cashflow,
      balance: balance ?? {},
    },
  };
}
