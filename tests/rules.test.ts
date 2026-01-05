import { evaluateRule, type RuleContext } from "../src/domain/rules";

describe("rules", () => {
  it("evaluates comparison rules", () => {
    const ctx: RuleContext = {
      index: 1,
      indicators: {
        a: [1, 2],
        b: [2, 1],
      },
    };

    expect(
      evaluateRule({ op: "gt", left: { type: "indicator", name: "a" }, right: { type: "indicator", name: "b" } }, ctx)
    ).toBe(true);
    expect(
      evaluateRule({ op: "lt", left: { type: "indicator", name: "a" }, right: { type: "constant", value: 3 } }, ctx)
    ).toBe(true);
  });

  it("evaluates cross up/down rules", () => {
    const ctx: RuleContext = {
      index: 1,
      indicators: {
        fast: [1, 3],
        slow: [2, 2],
      },
    };

    expect(
      evaluateRule({ op: "cross_up", left: { type: "indicator", name: "fast" }, right: { type: "indicator", name: "slow" } }, ctx)
    ).toBe(true);
    expect(
      evaluateRule({ op: "cross_down", left: { type: "indicator", name: "fast" }, right: { type: "indicator", name: "slow" } }, ctx)
    ).toBe(false);
  });

  it("evaluates AND/OR blocks", () => {
    const ctx: RuleContext = {
      index: 1,
      indicators: {
        a: [1, 2],
        b: [2, 1],
      },
    };

    expect(
      evaluateRule(
        {
          op: "and",
          rules: [
            { op: "gt", left: { type: "indicator", name: "a" }, right: { type: "indicator", name: "b" } },
            { op: "lt", left: { type: "indicator", name: "a" }, right: { type: "constant", value: 3 } },
          ],
        },
        ctx
      )
    ).toBe(true);

    expect(
      evaluateRule(
        {
          op: "or",
          rules: [
            { op: "gt", left: { type: "indicator", name: "b" }, right: { type: "indicator", name: "a" } },
            { op: "lt", left: { type: "indicator", name: "a" }, right: { type: "constant", value: 3 } },
          ],
        },
        ctx
      )
    ).toBe(true);
  });
});
