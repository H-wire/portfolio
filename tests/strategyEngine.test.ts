import { evaluateStrategy } from "../src/domain/strategyEngine";
import type { StrategyDefinition } from "../src/domain/strategy";

describe("strategy engine", () => {
  it("triggers signal when rule matches", () => {
    const definition: StrategyDefinition = {
      indicators: [{ name: "ma2", type: "SMA", period: 2 }],
      rule: {
        id: "buy",
        op: "gt",
        left: { type: "indicator", name: "ma2" },
        right: { type: "constant", value: 2 },
      },
      signals: [{ type: "BUY", rule_id: "buy" }],
    };

    const prices = [
      { date: "2024-01-01", close: 1 },
      { date: "2024-01-02", close: 5 },
    ];

    const signals = evaluateStrategy(definition, prices);
    expect(signals).toHaveLength(1);
    expect(signals[0].signal_type).toBe("BUY");
    expect(signals[0].payload.triggered_rule_id).toBe("buy");
  });

  it("skips signal when rule does not match", () => {
    const definition: StrategyDefinition = {
      indicators: [{ name: "ma2", type: "SMA", period: 2 }],
      rule: {
        id: "buy",
        op: "gt",
        left: { type: "indicator", name: "ma2" },
        right: { type: "constant", value: 10 },
      },
      signals: [{ type: "BUY", rule_id: "buy" }],
    };

    const prices = [
      { date: "2024-01-01", close: 1 },
      { date: "2024-01-02", close: 5 },
    ];

    const signals = evaluateStrategy(definition, prices);
    expect(signals).toHaveLength(0);
  });
});
