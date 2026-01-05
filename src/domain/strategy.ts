import { z } from "zod";
import type { IndicatorDefinition } from "./indicators";
import type { Rule } from "./rules";

const indicatorSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["SMA", "RSI"]),
  period: z.number().int().min(1).max(500),
  field: z.enum(["close"]).optional(),
});

const operandSchema = z.union([
  z.object({ type: z.literal("indicator"), name: z.string().min(1) }),
  z.object({ type: z.literal("constant"), value: z.number() }),
]);

const ruleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string().optional(),
      op: z.enum(["gt", "gte", "lt", "lte", "eq"]),
      left: operandSchema,
      right: operandSchema,
    }),
    z.object({
      id: z.string().optional(),
      op: z.enum(["cross_up", "cross_down"]),
      left: operandSchema,
      right: operandSchema,
    }),
    z.object({
      id: z.string().optional(),
      op: z.enum(["and", "or"]),
      rules: z.array(ruleSchema).min(1),
    }),
  ])
);

export const strategyDefinitionSchema = z.object({
  indicators: z.array(indicatorSchema).min(1),
  rule: ruleSchema,
  signals: z
    .array(
      z.object({
        type: z.enum(["BUY", "WATCH", "INFO"]),
        rule_id: z.string().min(1),
      })
    )
    .min(1),
});

export type StrategyDefinition = z.infer<typeof strategyDefinitionSchema>;

export function validateStrategyDefinition(definition: unknown) {
  const parsed = strategyDefinitionSchema.parse(definition);
  const indicatorNames = new Set(parsed.indicators.map((ind) => ind.name));
  const referenced = new Set<string>();

  function walk(rule: Rule) {
    switch (rule.op) {
      case "and":
      case "or":
        rule.rules.forEach(walk);
        return;
      default:
        if (rule.left.type === "indicator") {
          referenced.add(rule.left.name);
        }
        if (rule.right.type === "indicator") {
          referenced.add(rule.right.name);
        }
    }
  }

  walk(parsed.rule);

  for (const name of referenced) {
    if (!indicatorNames.has(name)) {
      throw new Error(`Unknown indicator referenced: ${name}`);
    }
  }

  const ruleIds = new Set<string>();
  function collectRuleIds(rule: Rule) {
    if (rule.id) {
      ruleIds.add(rule.id);
    }
    if (rule.op === "and" || rule.op === "or") {
      rule.rules.forEach(collectRuleIds);
    }
  }

  collectRuleIds(parsed.rule);
  for (const signal of parsed.signals) {
    if (!ruleIds.has(signal.rule_id)) {
      throw new Error(`Signal references missing rule_id: ${signal.rule_id}`);
    }
  }

  return parsed;
}

export function maxLookback(indicators: IndicatorDefinition[]) {
  if (indicators.length === 0) {
    return 0;
  }
  return Math.max(...indicators.map((ind) => ind.period));
}
