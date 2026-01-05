import { validateStrategyDefinition } from "../src/domain/strategy";

describe("strategy definition validation", () => {
  it("accepts valid definition", () => {
    const definition = {
      indicators: [
        { name: "ma50", type: "SMA", period: 50 },
        { name: "rsi14", type: "RSI", period: 14 },
      ],
      rule: {
        id: "buy_timing",
        op: "and",
        rules: [
          {
            op: "gt",
            left: { type: "indicator", name: "ma50" },
            right: { type: "constant", value: 100 },
          },
          {
            op: "gt",
            left: { type: "indicator", name: "rsi14" },
            right: { type: "constant", value: 50 },
          },
        ],
      },
      signals: [{ type: "BUY", rule_id: "buy_timing" }],
    };

    expect(validateStrategyDefinition(definition)).toEqual(definition);
  });

  it("rejects missing indicator references", () => {
    const definition = {
      indicators: [{ name: "ma50", type: "SMA", period: 50 }],
      rule: {
        id: "buy_timing",
        op: "gt",
        left: { type: "indicator", name: "missing" },
        right: { type: "constant", value: 100 },
      },
      signals: [{ type: "BUY", rule_id: "buy_timing" }],
    };

    expect(() => validateStrategyDefinition(definition)).toThrow(
      "Unknown indicator referenced: missing"
    );
  });

  it("rejects signals referencing missing rule ids", () => {
    const definition = {
      indicators: [{ name: "ma50", type: "SMA", period: 50 }],
      rule: {
        id: "buy_timing",
        op: "gt",
        left: { type: "indicator", name: "ma50" },
        right: { type: "constant", value: 100 },
      },
      signals: [{ type: "BUY", rule_id: "missing" }],
    };

    expect(() => validateStrategyDefinition(definition)).toThrow(
      "Signal references missing rule_id: missing"
    );
  });
});
