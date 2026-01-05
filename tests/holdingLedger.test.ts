const { computeRunningQuantity, resolveSeedAction } = require("../src/domain/holdings");

describe("computeRunningQuantity", () => {
  it("accumulates buys/seeds and subtracts sells", () => {
    const rows = [
      { trade_date: "2024-01-01", type: "BUY", quantity: 10 },
      { trade_date: "2024-02-01", type: "SELL", quantity: 4 },
      { trade_date: "2024-03-01", type: "POSITION_SEED", quantity: 2 },
    ];
    const result = computeRunningQuantity(rows);
    expect(result.map((row: { running_quantity: number }) => row.running_quantity)).toEqual([10, 6, 8]);
  });

  it("handles numeric strings and null quantities", () => {
    const rows = [
      { trade_date: "2024-01-01", type: "BUY", quantity: "5" },
      { trade_date: "2024-02-01", type: "SELL", quantity: null },
    ];
    const result = computeRunningQuantity(rows);
    expect(result.map((row: { running_quantity: number }) => row.running_quantity)).toEqual([5, 5]);
  });
});

describe("resolveSeedAction", () => {
  it("inserts when no existing types", () => {
    expect(resolveSeedAction([])).toBe("insert");
  });

  it("updates when only POSITION_SEED exists", () => {
    expect(resolveSeedAction(["POSITION_SEED", "POSITION_SEED"])).toBe("update");
  });

  it("rejects when non-seed types exist", () => {
    expect(resolveSeedAction(["POSITION_SEED", "BUY"])).toBe("reject");
  });
});
