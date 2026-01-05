export type FmpIncomeQuarter = {
  date?: string;
  revenue?: number | string | null;
  ebit?: number | string | null;
  ebitda?: number | string | null;
  netIncome?: number | string | null;
  eps?: number | string | null;
  incomeTaxExpense?: number | string | null;
};

export type FmpCashFlowQuarter = {
  date?: string;
  operatingCashFlow?: number | string | null;
  capitalExpenditure?: number | string | null;
};

export type FmpBalanceSheetQuarter = {
  date?: string;
  totalDebt?: number | string | null;
  cashAndCashEquivalents?: number | string | null;
  totalStockholdersEquity?: number | string | null;
  weightedAverageShsOut?: number | string | null;
};

export type FmpFundamentalsResponse = {
  income: FmpIncomeQuarter[];
  cashflow: FmpCashFlowQuarter[];
  balance: FmpBalanceSheetQuarter | null;
};
