import type { NormalizedFundamentals } from "./fmpAdapter";

export type YfinanceFundamentalsResponse = {
  ticker: string;
  as_of_date: string;
  revenue_ttm: number | string | null;
  eps_ttm: number | string | null;
  ebitda_ttm: number | string | null;
  net_income_ttm: number | string | null;
  income_tax_expense_ttm: number | string | null;
  operating_cashflow_ttm: number | string | null;
  capital_expenditure_ttm: number | string | null;
  ebit_ttm: number | string | null;
  tax_rate: number | string | null;
  total_debt: number | string | null;
  total_equity: number | string | null;
  cash_and_equivalents: number | string | null;
  shares_outstanding: number | string | null;
  raw: Record<string, unknown>;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeYfinanceFundamentals(
  response: YfinanceFundamentalsResponse
): NormalizedFundamentals {
  return {
    asOfDate: response.as_of_date,
    revenueTtm: toNumber(response.revenue_ttm),
    epsTtm: toNumber(response.eps_ttm),
    ebitdaTtm: toNumber(response.ebitda_ttm),
    netIncomeTtm: toNumber(response.net_income_ttm),
    incomeTaxExpenseTtm: toNumber(response.income_tax_expense_ttm),
    operatingCashflowTtm: toNumber(response.operating_cashflow_ttm),
    capitalExpenditureTtm: toNumber(response.capital_expenditure_ttm),
    ebitTtm: toNumber(response.ebit_ttm),
    taxRate: toNumber(response.tax_rate),
    totalDebt: toNumber(response.total_debt),
    totalEquity: toNumber(response.total_equity),
    cashAndEquivalents: toNumber(response.cash_and_equivalents),
    sharesOutstanding: toNumber(response.shares_outstanding),
    raw: response.raw ?? {},
  };
}
