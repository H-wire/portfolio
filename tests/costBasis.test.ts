import { applyTransaction, type Holding } from "../src/domain/costBasis";

describe("applyTransaction", () => {
  it("updates weighted average cost on buys", () => {
    const holding: Holding = { quantity: 0, avgCostBase: 0 };

    applyTransaction(holding, { type: "BUY", quantity: 10, price: 100, fees: 5 }, 1);
    expect(holding.quantity).toBe(10);
    expect(holding.avgCostBase).toBeCloseTo(100.5);

    applyTransaction(holding, { type: "BUY", quantity: 10, price: 110, fees: 0 }, 1);
    expect(holding.quantity).toBe(20);
    expect(holding.avgCostBase).toBeCloseTo(105.25);
  });

  it("reduces quantity without changing avg cost on sells", () => {
    const holding: Holding = { quantity: 20, avgCostBase: 105.25 };

    applyTransaction(holding, { type: "SELL", quantity: 5, price: 120, fees: 1 }, 1);
    expect(holding.quantity).toBe(15);
    expect(holding.avgCostBase).toBeCloseTo(105.25);
  });

  it("resets avg cost when position closes", () => {
    const holding: Holding = { quantity: 5, avgCostBase: 80 };

    applyTransaction(holding, { type: "SELL", quantity: 5, price: 90, fees: 0 }, 1);
    expect(holding.quantity).toBe(0);
    expect(holding.avgCostBase).toBe(0);
  });
});
