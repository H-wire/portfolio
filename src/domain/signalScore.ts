import { computeRSI, computeSMA, type PricePoint } from "./indicators";

type SignalScoreComponents = {
  trend: number;
  momentum: number;
  confirmation: number;
  risk: number;
};

type SignalScoreResult = {
  score: number;
  components: SignalScoreComponents;
  reason: string;
};

function buildReason(components: SignalScoreComponents) {
  const parts: string[] = [];
  if (components.trend === 2) {
    parts.push("Strong trend");
  } else if (components.trend === 1) {
    parts.push("Trend building");
  }
  if (components.momentum === 1) {
    parts.push("Momentum cross");
  }
  if (components.confirmation === 1) {
    parts.push("Breakout confirmation");
  }
  if (components.risk === 1) {
    parts.push("Not extended");
  }
  if (parts.length === 0) {
    return "Early setup";
  }
  return parts.join(", ");
}

export function scoreBuySignal(prices: PricePoint[]): SignalScoreResult {
  const closes = prices.map((point) => point.close);
  const index = closes.length - 1;
  if (index < 0) {
    return {
      score: 1,
      components: { trend: 0, momentum: 0, confirmation: 0, risk: 0 },
      reason: "Insufficient data",
    };
  }

  const sma50Series = computeSMA(closes, 50);
  const sma200Series = computeSMA(closes, 200);
  const rsiSeries = computeRSI(closes, 14);

  const sma50 = sma50Series[index];
  const sma200 = sma200Series[index];
  const close = closes[index];

  let trend = 0;
  if (sma50 !== null && sma200 !== null) {
    if (sma50 > sma200) {
      trend += 1;
    }
    if (sma200 > 0 && (sma50 - sma200) / sma200 >= 0.02) {
      trend += 1;
    }
  }

  let momentum = 0;
  const prevRsi = rsiSeries[index - 1] ?? null;
  const currRsi = rsiSeries[index] ?? null;
  if (prevRsi !== null && currRsi !== null && prevRsi < 50 && currRsi >= 50) {
    momentum = 1;
  }

  let confirmation = 0;
  if (index >= 20) {
    const prior = closes.slice(index - 20, index);
    const maxPrior = Math.max(...prior);
    if (close >= maxPrior) {
      confirmation = 1;
    }
  }

  let risk = 0;
  if (sma50 !== null && close <= 1.05 * sma50) {
    risk = 1;
  }

  const components = { trend, momentum, confirmation, risk };
  const rawScore = trend + momentum + confirmation + risk;
  const score = Math.max(1, Math.min(5, rawScore));

  return {
    score,
    components,
    reason: buildReason(components),
  };
}
