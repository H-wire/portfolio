const { computeHoldingStartDate, resolvePriceRange } = require("../src/domain/holdings");

describe("computeHoldingStartDate", () => {
  it("returns earliest BUY or POSITION_SEED with positive quantity", () => {
    const result = computeHoldingStartDate([
      { trade_date: "2024-05-01", type: "SELL", quantity: 10 },
      { trade_date: "2024-04-01", type: "BUY", quantity: 5 },
      { trade_date: "2024-03-15", type: "POSITION_SEED", quantity: 100 },
      { trade_date: "2024-02-01", type: "BUY", quantity: 0 },
    ]);
    expect(result).toBe("2024-03-15");
  });

  it("normalizes timestamps and ignores non-positive quantities", () => {
    const result = computeHoldingStartDate([
      { trade_date: "2024-01-10T12:00:00.000Z", type: "BUY", quantity: "10" },
      { trade_date: "2024-01-01T00:00:00.000Z", type: "BUY", quantity: "0" },
    ]);
    expect(result).toBe("2024-01-10");
  });

  it("returns null when no qualifying transactions", () => {
    const result = computeHoldingStartDate([
      { trade_date: "2024-01-01", type: "SELL", quantity: 5 },
    ]);
    expect(result).toBeNull();
  });
});

describe("resolvePriceRange", () => {
  it("uses start date for ALL", () => {
    const result = resolvePriceRange("ALL", "2022-01-01", "2024-06-01");
    expect(result).toEqual({ from: "2022-01-01", to: "2024-06-01" });
  });

  it("defaults ALL to today when start date missing", () => {
    const result = resolvePriceRange("ALL", null, "2024-06-01");
    expect(result).toEqual({ from: "2024-06-01", to: "2024-06-01" });
  });

  it("calculates YTD from Jan 1", () => {
    const result = resolvePriceRange("YTD", null, "2024-06-01");
    expect(result).toEqual({ from: "2024-01-01", to: "2024-06-01" });
  });

  it("calculates 90D from today minus 90 days", () => {
    const result = resolvePriceRange("90D", null, "2024-06-01");
    expect(result.to).toBe("2024-06-01");
    expect(result.from).toBe("2024-03-03");
  });
});
