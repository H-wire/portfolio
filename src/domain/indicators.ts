export type PricePoint = {
  date: string;
  close: number;
};

export type PriceBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type IndicatorDefinition = {
  name: string;
  type: "SMA" | "RSI";
  period: number;
  field?: "close";
};

export function computeSMA(values: number[], period: number) {
  const result: Array<number | null> = [];
  if (period <= 0) {
    return values.map(() => null);
  }
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i + 1 >= period) {
      result.push(sum / period);
    } else {
      result.push(null);
    }
  }
  return result;
}

export function computeRSI(values: number[], period: number) {
  const result: Array<number | null> = values.map(() => null);
  if (period <= 0 || values.length <= period) {
    return result;
  }

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) {
      gainSum += change;
    } else {
      lossSum += Math.abs(change);
    }
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  const firstIndex = period;
  result[firstIndex] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }

  return result;
}

export function computeATR(bars: PriceBar[], period: number) {
  const result: Array<number | null> = bars.map(() => null);
  if (period <= 0 || bars.length < period) {
    return result;
  }

  const trueRanges = bars.map((bar, index) => {
    if (index === 0) {
      return bar.high - bar.low;
    }
    const prevClose = bars[index - 1].close;
    const range1 = bar.high - bar.low;
    const range2 = Math.abs(bar.high - prevClose);
    const range3 = Math.abs(bar.low - prevClose);
    return Math.max(range1, range2, range3);
  });

  let sum = 0;
  for (let i = 0; i < trueRanges.length; i += 1) {
    sum += trueRanges[i];
    if (i >= period) {
      sum -= trueRanges[i - period];
    }
    if (i + 1 >= period) {
      result[i] = sum / period;
    }
  }

  return result;
}

export function computeIndicators(definitions: IndicatorDefinition[], prices: PricePoint[]) {
  const close = prices.map((point) => point.close);
  const output: Record<string, Array<number | null>> = {};

  for (const def of definitions) {
    if (def.period <= 0) {
      output[def.name] = close.map(() => null);
      continue;
    }
    if (def.type === "SMA") {
      output[def.name] = computeSMA(close, def.period);
      continue;
    }
    if (def.type === "RSI") {
      output[def.name] = computeRSI(close, def.period);
      continue;
    }
  }

  return output;
}
