export type Org = {
  org_id: number;
  name: string;
  role: string;
  created_at: string;
};

export type Portfolio = {
  id: number;
  name: string;
  base_currency: string;
  created_at: string;
  updated_at: string;
};

export type Position = {
  listing_id: number;
  ticker: string | null;
  instrument_id: number | null;
  instrument_name: string | null;
  sector: string | null;
  currency: string | null;
  quantity: number;
  avg_cost_base: number;
  cost_basis_base: number;
  price_close: number | null;
  price_date: string | null;
  market_value_base: number | null;
  day_change_base: number | null;
  total_pnl_base: number | null;
  estimated: boolean;
};

export type Allocation = {
  by_instrument: Array<{
    instrument_id: number;
    name: string | null;
    value_base: number;
    weight: number;
  }>;
  by_sector: Array<{
    sector: string;
    value_base: number;
    weight: number;
  }>;
  by_currency: Array<{
    currency: string;
    value_base: number;
    weight: number;
  }>;
  total_value_base: number;
};

export type PerformancePoint = {
  date: string;
  total_value_base: number;
  estimated: boolean;
};

export type DashboardSummary = {
  total_market_value_base: number;
  pnl_day_base: {
    absolute: number;
    percent: number;
  };
  count_new_buy_signals_today: number;
  count_positions_up_today: number;
  count_positions_down_today: number;
  last_price_date: string | null;
};

export type ListingPricePoint = {
  date: string;
  close: number;
};

export type ListingPriceAvailability = {
  start_date: string | null;
  earliest_price_date: string | null;
  latest_price_date: string | null;
  missing_from_start: boolean;
};

export type FundamentalsSnapshot = {
  instrument_id: number;
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
  raw?: Record<string, unknown>;
  source: string;
  created_at: string;
};

export type HoldingTransaction = {
  id: number;
  trade_date: string;
  type: string;
  quantity: number;
  price: number | null;
  currency: string;
  fees: number | null;
  notes: string | null;
  created_at: string;
  running_quantity: number;
};

export type FactorScore = {
  listing_id: number;
  instrument_id: number;
  as_of_date: string;
  quality_score: number | string | null;
  trend_score: number | string | null;
  rs_score: number | string | null;
  timing_score: number | string | null;
  vol_score: number | string | null;
  total_score: number | string | null;
  passed_quality_filter: boolean;
  passed_trend_filter: boolean;
  payload: {
    reason?: string;
    passes?: { qualityFilter?: boolean; trendFilter?: boolean };
    scores?: Record<string, number | null>;
  };
  ticker: string;
  instrument_name: string | null;
};

export type RecommendationItem = {
  listing_id: number;
  ticker: string;
  total_score: number | null;
  scores: {
    quality: number | null;
    trend: number | null;
    rs: number | null;
    timing: number | null;
    vol: number | null;
  };
  reason: string;
  eligible: boolean;
  recommended: boolean;
};

export type Recommendation = {
  id: number;
  as_of_month: string;
  risk_level: number;
  top_n: number;
  items: RecommendationItem[];
  created_at: string;
};

export type AnalysisResult = {
  id: number;
  response_text: string;
};

export type RegimeScorecardItem = {
  factor: string;
  value: string;
  status: "Bull" | "Bear" | "Neutral";
};

export type RegimeChartSeries = {
  dates: string[];
  close: Array<number | null>;
  ma50?: Array<number | null>;
  ma200?: Array<number | null>;
  rsi?: Array<number | null>;
  vix?: Array<number | null>;
};

export type RegimeAnalysis = {
  regime: "Bull" | "Bear" | "Neutral";
  total_score: number;
  scorecard: RegimeScorecardItem[];
  charts: {
    price_history: RegimeChartSeries;
    rsi_history: RegimeChartSeries;
    vix_history: RegimeChartSeries;
  };
};

export type NewsItem = {
  id: number;
  source: string;
  title: string;
  published_at: string;
  url: string;
  summary: string | null;
  match_bases?: string[];
};

export type Notification = {
  id: number;
  status: string;
  channel: string;
  sent_at: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type Exchange = {
  id: number;
  mic_code: string | null;
  name: string;
  country: string;
  timezone: string;
};

export type ListingSearch = {
  id: number;
  ticker: string;
  currency: string;
  instrument_id: number;
  instrument_name: string;
  exchange_id: number;
  exchange_name: string;
  exchange_mic: string | null;
};

export interface RegimeAnalysisRequest {
  index_ticker?: string;
  vix_ticker?: string;
  start_date?: string;
  ma_short?: number;
  ma_long?: number;
  rsi_period?: number;
  rsi_threshold?: number;
  vix_threshold_bull?: number;
  vix_threshold_bear?: number;
  component_tickers?: string[];
}

export interface ScorecardItem {
  factor: string;
  value: string;
  status: string;
}

export interface ChartData {
  dates: string[];
  close: (number | null)[];
  ma50?: (number | null)[];
  ma200?: (number | null)[];
  rsi?: (number | null)[];
  vix?: (number | null)[];
}

export interface RegimeAnalysisCharts {
  price_history: ChartData;
  rsi_history: ChartData;
  vix_history: ChartData;
}

export interface RegimeAnalysisResponse {
  regime: string;
  total_score: number;
  scorecard: ScorecardItem[];
  charts: RegimeAnalysisCharts;
}

