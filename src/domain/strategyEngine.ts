import { computeIndicators, type IndicatorDefinition, type PricePoint } from "./indicators";
import { evaluateRule, type Rule } from "./rules";
import type { StrategyDefinition } from "./strategy";

export type SignalResult = {
  signal_type: string;
  triggered_rule_id: string;
  payload: {
    values: Record<string, number | null>;
    triggered_rule_id: string;
    reason: string;
  };
};

function findRuleById(rule: Rule, ruleId: string): Rule | null {
  if (rule.id === ruleId) {
    return rule;
  }
  if (rule.op === "and" || rule.op === "or") {
    for (const child of rule.rules) {
      const match = findRuleById(child, ruleId);
      if (match) {
        return match;
      }
    }
  }
  return null;
}

function buildValues(indicators: Record<string, Array<number | null>>, index: number) {
  const values: Record<string, number | null> = {};
  for (const [name, series] of Object.entries(indicators)) {
    values[name] = series[index] ?? null;
  }
  return values;
}

export function evaluateStrategy(definition: StrategyDefinition, prices: PricePoint[]) {
  const indicators = computeIndicators(definition.indicators as IndicatorDefinition[], prices);
  const index = prices.length - 1;
  const ctx = { index, indicators };
  const values = buildValues(indicators, index);

  const triggered: SignalResult[] = [];
  for (const signal of definition.signals) {
    const rule = findRuleById(definition.rule, signal.rule_id);
    if (!rule) {
      continue;
    }
    if (evaluateRule(rule, ctx)) {
      triggered.push({
        signal_type: signal.type,
        triggered_rule_id: signal.rule_id,
        payload: {
          values,
          triggered_rule_id: signal.rule_id,
          reason: `Rule ${signal.rule_id} triggered`,
        },
      });
    }
  }

  return triggered;
}
