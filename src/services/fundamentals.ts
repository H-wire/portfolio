import { query } from "../db";
import type { NormalizedFundamentals } from "../fundamentals/fmpAdapter";

export type FundamentalsRow = {
  instrument_id: number;
  as_of_date: string;
  revenue_ttm: string | null;
  eps_ttm: string | null;
  ebitda_ttm: string | null;
  net_income_ttm: string | null;
  income_tax_expense_ttm: string | null;
  operating_cashflow_ttm: string | null;
  capital_expenditure_ttm: string | null;
  ebit_ttm: string | null;
  tax_rate: string | null;
  total_debt: string | null;
  total_equity: string | null;
  cash_and_equivalents: string | null;
  shares_outstanding: string | null;
  raw: Record<string, unknown>;
  source: string;
  created_at: Date;
};

export async function getLatestFundamentals(instrumentId: number) {
  const result = await query<FundamentalsRow>(
    `select instrument_id, as_of_date, revenue_ttm, eps_ttm, ebitda_ttm, net_income_ttm,
            income_tax_expense_ttm, operating_cashflow_ttm, capital_expenditure_ttm, ebit_ttm, tax_rate,
            total_debt, total_equity, cash_and_equivalents, shares_outstanding, raw, source, created_at
     from fundamentals_ttm
     where instrument_id = $1
     order by as_of_date desc, created_at desc
     limit 1`,
    [instrumentId]
  );
  return result.rows[0] ?? null;
}

export async function upsertFundamentalsTtm(
  instrumentId: number,
  source: string,
  payload: NormalizedFundamentals
) {
  await query(
    `insert into fundamentals_ttm
     (instrument_id, as_of_date, revenue_ttm, eps_ttm, ebitda_ttm, net_income_ttm,
      income_tax_expense_ttm, operating_cashflow_ttm, capital_expenditure_ttm, ebit_ttm, tax_rate,
      total_debt, total_equity, cash_and_equivalents, shares_outstanding, raw, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict (instrument_id, as_of_date, source)
     do update set
       revenue_ttm = excluded.revenue_ttm,
       eps_ttm = excluded.eps_ttm,
       ebitda_ttm = excluded.ebitda_ttm,
       net_income_ttm = excluded.net_income_ttm,
       income_tax_expense_ttm = excluded.income_tax_expense_ttm,
       operating_cashflow_ttm = excluded.operating_cashflow_ttm,
       capital_expenditure_ttm = excluded.capital_expenditure_ttm,
       ebit_ttm = excluded.ebit_ttm,
       tax_rate = excluded.tax_rate,
       total_debt = excluded.total_debt,
       total_equity = excluded.total_equity,
       cash_and_equivalents = excluded.cash_and_equivalents,
       shares_outstanding = excluded.shares_outstanding,
       raw = excluded.raw`,
    [
      instrumentId,
      payload.asOfDate,
      payload.revenueTtm,
      payload.epsTtm,
      payload.ebitdaTtm,
      payload.netIncomeTtm,
      payload.incomeTaxExpenseTtm,
      payload.operatingCashflowTtm,
      payload.capitalExpenditureTtm,
      payload.ebitTtm,
      payload.taxRate,
      payload.totalDebt,
      payload.totalEquity,
      payload.cashAndEquivalents,
      payload.sharesOutstanding,
      payload.raw,
      source,
    ]
  );
}
