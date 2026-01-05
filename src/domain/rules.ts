export type Operand =
  | { type: "indicator"; name: string }
  | { type: "constant"; value: number };

export type Rule =
  | {
      id?: string;
      op: "gt" | "gte" | "lt" | "lte" | "eq";
      left: Operand;
      right: Operand;
    }
  | {
      id?: string;
      op: "cross_up" | "cross_down";
      left: Operand;
      right: Operand;
    }
  | {
      id?: string;
      op: "and" | "or";
      rules: Rule[];
    };

export type RuleContext = {
  index: number;
  indicators: Record<string, Array<number | null>>;
};

function getValue(operand: Operand, ctx: RuleContext, offset = 0) {
  if (operand.type === "constant") {
    return operand.value;
  }
  const series = ctx.indicators[operand.name];
  if (!series) {
    return null;
  }
  const idx = ctx.index + offset;
  if (idx < 0 || idx >= series.length) {
    return null;
  }
  return series[idx] ?? null;
}

function compareValues(op: "gt" | "gte" | "lt" | "lte" | "eq", left: number, right: number) {
  switch (op) {
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    case "eq":
      return left === right;
  }
}

export function evaluateRule(rule: Rule, ctx: RuleContext): boolean {
  switch (rule.op) {
    case "and": {
      if (rule.rules.length === 0) {
        return false;
      }
      return rule.rules.every((child) => evaluateRule(child, ctx));
    }
    case "or": {
      if (rule.rules.length === 0) {
        return false;
      }
      return rule.rules.some((child) => evaluateRule(child, ctx));
    }
    case "cross_up":
    case "cross_down": {
      const leftValue = getValue(rule.left, ctx, 0);
      const rightValue = getValue(rule.right, ctx, 0);
      if (leftValue === null || rightValue === null) {
        return false;
      }
      const leftPrev = getValue(rule.left, ctx, -1);
      const rightPrev = getValue(rule.right, ctx, -1);
      if (leftPrev === null || rightPrev === null) {
        return false;
      }
      if (rule.op === "cross_up") {
        return leftPrev <= rightPrev && leftValue > rightValue;
      }
      return leftPrev >= rightPrev && leftValue < rightValue;
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "eq": {
      const leftValue = getValue(rule.left, ctx, 0);
      const rightValue = getValue(rule.right, ctx, 0);
      if (leftValue === null || rightValue === null) {
        return false;
      }
      return compareValues(rule.op, leftValue, rightValue);
    }
  }
}
