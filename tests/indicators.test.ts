import { computeATR, computeRSI, computeSMA } from "../src/domain/indicators";

describe("indicators", () => {
  it("computes SMA with nulls for insufficient history", () => {
    const values = [1, 2, 3, 4, 5];
    const sma = computeSMA(values, 3);
    expect(sma).toEqual([null, null, 2, 3, 4]);
  });

  it("computes RSI at 100 for strictly increasing series", () => {
    const values = Array.from({ length: 15 }, (_, i) => i + 1);
    const rsi = computeRSI(values, 14);
    expect(rsi[14]).toBe(100);
  });

  it("computes RSI near 0 for strictly decreasing series", () => {
    const values = Array.from({ length: 15 }, (_, i) => 15 - i);
    const rsi = computeRSI(values, 14);
    expect(rsi[14]).toBeCloseTo(0);
  });

  it("computes ATR over price bars", () => {
    const bars = [
      { date: "2024-01-01", open: 10, high: 12, low: 9, close: 11 },
      { date: "2024-01-02", open: 11, high: 13, low: 10, close: 12 },
      { date: "2024-01-03", open: 12, high: 14, low: 11, close: 13 },
    ];
    const atr = computeATR(bars as any, 2);
    expect(atr[1]).not.toBeNull();
  });
});
