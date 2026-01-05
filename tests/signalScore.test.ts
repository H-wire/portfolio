import { scoreBuySignal } from "../src/domain/signalScore";
import { computeRSI, type PricePoint } from "../src/domain/indicators";

function buildSeries(start: number, step: number, days: number): PricePoint[] {
  return Array.from({ length: days }, (_, index) => ({
    date: `2024-01-${String(index + 1).padStart(2, "0")}`,
    close: start + step * index,
  }));
}

describe("scoreBuySignal", () => {
  it("scores trend, confirmation, and risk on a steady uptrend", () => {
    const prices = buildSeries(100, 0.1, 220);
    const result = scoreBuySignal(prices);

    expect(result.components.trend).toBe(2);
    expect(result.components.confirmation).toBe(1);
    expect(result.components.risk).toBe(1);
    expect(result.components.momentum).toBe(0);
    expect(result.score).toBe(4);
  });

  it("respects RSI cross rule for momentum", () => {
    const prices: PricePoint[] = [];
    let value = 100;
    for (let i = 0; i < 20; i += 1) {
      prices.push({ date: `2024-02-${String(i + 1).padStart(2, "0")}`, close: value });
    }
    for (let i = 0; i < 20; i += 1) {
      value -= 1;
      prices.push({ date: `2024-03-${String(i + 1).padStart(2, "0")}`, close: value });
    }
    value += 8;
    prices.push({ date: "2024-04-01", close: value });

    const rsi = computeRSI(
      prices.map((point) => point.close),
      14
    );
    const index = prices.length - 1;
    const expectedMomentum =
      rsi[index - 1] !== null && rsi[index] !== null && rsi[index - 1]! < 50 && rsi[index]! >= 50
        ? 1
        : 0;

    const result = scoreBuySignal(prices);
    expect(result.components.momentum).toBe(expectedMomentum);
  });

  it("floors score at 1 when no components trigger", () => {
    const prices = buildSeries(100, 0, 10);
    const result = scoreBuySignal(prices);

    expect(result.score).toBe(1);
  });
});
