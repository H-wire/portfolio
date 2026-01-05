import { computeCostBasis, computeDayChange, computeMarketValue, computeTotalPnL } from "../src/domain/pnl";

describe("pnl", () => {
  it("computes market value and pnl", () => {
    const marketValue = computeMarketValue(10, 50, 1.2);
    expect(marketValue).toBeCloseTo(600);

    const costBasis = computeCostBasis(10, 40);
    expect(costBasis).toBe(400);

    const totalPnl = computeTotalPnL(marketValue, costBasis);
    expect(totalPnl).toBeCloseTo(200);
  });

  it("computes day change", () => {
    const dayChange = computeDayChange(110, 100, 5, 1);
    expect(dayChange).toBeCloseTo(50);
  });

  it("handles missing prices", () => {
    expect(computeMarketValue(5, null, 1)).toBeNull();
    expect(computeTotalPnL(null, 100)).toBeNull();
    expect(computeDayChange(null, 100, 1, 1)).toBeNull();
  });
});
