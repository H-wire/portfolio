import { computeATR, computeRSI, computeSMA, type PriceBar } from "./indicators";

export type FundamentalsInput = {
  epsTtm: number | null;
  operatingCashflowTtm: number | null;
  ebitTtm: number | null;
  taxRate: number | null;
  totalDebt: number | null;
  totalEquity: number | null;
  cashAndEquivalents: number | null;
};

export type FactorRawMetrics = {
  price: number | null;
  ma50: number | null;
  ma200: number | null;
  rsi14: number | null;
  atr20: number | null;
  volatility: number | null;
  rs6m: number | null;
  rs12m: number | null;
  rs: number | null;
  roic: number | null;
  trendRaw: number | null;
};

export type FactorScores = {
  qualityScore: number | null;
  trendScore: number | null;
  rsScore: number | null;
  timingScore: number | null;
  volScore: number | null;
  totalScore: number | null;
};

export type FactorPasses = {
  qualityFilter: boolean;
  trendFilter: boolean;
};

export type WeightSet = {
  w_quality: number;
  w_trend: number;
  w_momentum: number;
  w_timing: number;
  w_vol: number;
};

export type FactorPayload = {
  values: Record<string, number | null>;
  scores: Record<string, number | null>;
  passes: FactorPasses;
  weights: WeightSet;
  reason: string;
};

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`).getTime();
}

function monthsAgo(date: string | Date, months: number) {
  const parsed =
    date instanceof Date
      ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
      : new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() - months;
  const day = parsed.getUTCDate();
  const target = new Date(Date.UTC(year, month, day));
  return target.toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function percentileRank(values: Array<number | null>) {
  const entries = values
    .map((value, index) => ({ index, value }))
    .filter((entry): entry is { index: number; value: number } =>
      entry.value !== null && Number.isFinite(entry.value)
    )
    .sort((a, b) => (a.value === b.value ? a.index - b.index : a.value - b.value));

  const ranks: Array<number | null> = values.map(() => null);
  if (entries.length === 0) {
    return ranks;
  }
  if (entries.length === 1) {
    ranks[entries[0].index] = 100;
    return ranks;
  }

  let i = 0;
  while (i < entries.length) {
    const value = entries[i].value;
    let j = i;
    while (j < entries.length && entries[j].value === value) {
      j += 1;
    }
    const start = i;
    const end = j - 1;
    const avgPos = (start + end) / 2;
    const rank = (avgPos / (entries.length - 1)) * 100;
    for (let k = i; k < j; k += 1) {
      ranks[entries[k].index] = rank;
    }
    i = j;
  }

  return ranks;
}

export function computeRoic(fundamentals: FundamentalsInput): number | null {
  const { ebitTtm, taxRate, totalDebt, totalEquity, cashAndEquivalents } = fundamentals;
  if (ebitTtm === null || totalDebt === null || totalEquity === null || cashAndEquivalents === null) {
    return null;
  }
  const tax = taxRate ?? 0;
  const nopat = ebitTtm * (1 - tax);
  const investedCapital = totalDebt + totalEquity - cashAndEquivalents;
  if (!Number.isFinite(nopat) || investedCapital <= 0) {
    return null;
  }
  return nopat / investedCapital;
}

export function computeTrendRaw(price: number | null, ma50: number | null, ma200: number | null): number | null {
  if (price === null || ma50 === null || ma200 === null || ma50 === 0 || ma200 === 0) {
    return null;
  }
  return 0.5 * (price / ma200 - 1) + 0.3 * (ma50 / ma200 - 1) + 0.2 * (price / ma50 - 1);
}

export function computeTimingScore(rsi: number | null, riskLevel: number): number | null {
  if (rsi === null) {
    return null;
  }
  const target = 50 - (riskLevel - 5) * 2;
  const raw = 1 - Math.abs(rsi - target) / 30;
  return clamp(raw, 0, 1) * 100;
}

function getCloseOnOrBefore(prices: PriceBar[], targetDate: string): number | null {
  const target = parseDate(targetDate);
  for (let i = prices.length - 1; i >= 0; i -= 1) {
    if (parseDate(prices[i].date) <= target) {
      return prices[i].close;
    }
  }
  return null;
}

export function computeRelativeStrength(prices: PriceBar[], asOfDate: string | Date) {
  const price = prices[prices.length - 1]?.close ?? null;
  const price6m = getCloseOnOrBefore(prices, monthsAgo(asOfDate, 6));
  const price12m = getCloseOnOrBefore(prices, monthsAgo(asOfDate, 12));

  const rs6m = price && price6m ? price / price6m - 1 : null;
  const rs12m = price && price12m ? price / price12m - 1 : null;
  const rs = rs6m !== null && rs12m !== null ? 0.6 * rs6m + 0.4 * rs12m : null;

  return { rs6m, rs12m, rs };
}

export function computeRawMetrics(prices: PriceBar[], fundamentals: FundamentalsInput): FactorRawMetrics {
  if (prices.length === 0) {
    return {
      price: null,
      ma50: null,
      ma200: null,
      rsi14: null,
      atr20: null,
      volatility: null,
      rs6m: null,
      rs12m: null,
      rs: null,
      roic: null,
      trendRaw: null,
    };
  }

  const closes = prices.map((point) => point.close);
  const price = closes[closes.length - 1] ?? null;
  const ma50Series = computeSMA(closes, 50);
  const ma200Series = computeSMA(closes, 200);
  const rsiSeries = computeRSI(closes, 14);
  const atrSeries = computeATR(prices, 20);

  const ma50 = ma50Series[ma50Series.length - 1] ?? null;
  const ma200 = ma200Series[ma200Series.length - 1] ?? null;
  const rsi14 = rsiSeries[rsiSeries.length - 1] ?? null;
  const atr20 = atrSeries[atrSeries.length - 1] ?? null;
  const volatility = price && atr20 ? atr20 / price : null;
  const roic = computeRoic(fundamentals);
  const trendRaw = computeTrendRaw(price, ma50, ma200);
  const { rs6m, rs12m, rs } = computeRelativeStrength(prices, prices[prices.length - 1].date);

  return {
    price,
    ma50,
    ma200,
    rsi14,
    atr20,
    volatility,
    rs6m,
    rs12m,
    rs,
    roic,
    trendRaw,
  };
}

export function passesQualityFilter(fundamentals: FundamentalsInput) {
  return (fundamentals.epsTtm ?? 0) > 0 && (fundamentals.operatingCashflowTtm ?? 0) > 0;
}

export function passesTrendFilter(price: number | null, ma50: number | null, ma200: number | null) {
  if (price === null || ma50 === null || ma200 === null) {
    return false;
  }
  return price > ma200 && ma50 > ma200;
}

const anchors: Record<number, WeightSet> = {
  2: { w_quality: 0.4, w_trend: 0.3, w_momentum: 0.1, w_timing: 0.1, w_vol: 0.1 },
  5: { w_quality: 0.25, w_trend: 0.25, w_momentum: 0.25, w_timing: 0.15, w_vol: 0.1 },
  8: { w_quality: 0.1, w_trend: 0.2, w_momentum: 0.45, w_timing: 0.15, w_vol: 0.1 },
  9: { w_quality: 0.1, w_trend: 0.2, w_momentum: 0.45, w_timing: 0.15, w_vol: 0.1 },
  10: { w_quality: 0.05, w_trend: 0.15, w_momentum: 0.55, w_timing: 0.15, w_vol: 0.1 },
};

function interpolateWeights(low: WeightSet, high: WeightSet, t: number): WeightSet {
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    w_quality: lerp(low.w_quality, high.w_quality),
    w_trend: lerp(low.w_trend, high.w_trend),
    w_momentum: lerp(low.w_momentum, high.w_momentum),
    w_timing: lerp(low.w_timing, high.w_timing),
    w_vol: lerp(low.w_vol, high.w_vol),
  };
}

export function weightsForRiskLevel(riskLevel: number): WeightSet {
  const level = clamp(riskLevel, 1, 10);
  if (level <= 2) {
    return anchors[2];
  }
  if (level <= 5) {
    return interpolateWeights(anchors[2], anchors[5], (level - 2) / 3);
  }
  if (level <= 8) {
    return interpolateWeights(anchors[5], anchors[8], (level - 5) / 3);
  }
  if (level <= 9) {
    return anchors[9];
  }
  return interpolateWeights(anchors[9], anchors[10], level - 9);
}

export function buildReason(passes: FactorPasses, scores: FactorScores) {
  if (!passes.qualityFilter && !passes.trendFilter) {
    return "Failed quality (EPS/OCF) and trend (MA) filters.";
  }
  if (!passes.qualityFilter) {
    return "Failed quality filter (EPS/OCF).";
  }
  if (!passes.trendFilter) {
    return "Failed trend filter (Price/MA200 and MA50>MA200).";
  }
  const total = scores.totalScore ?? 0;
  return `Passed filters. TotalScore ${total.toFixed(1)}.`;
}
