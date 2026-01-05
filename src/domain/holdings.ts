export type HoldingTransaction = {
  trade_date: string;
  type: string;
  quantity: number | string | null;
};

function normalizeDate(value: string) {
  if (!value) {
    return "";
  }
  return value.slice(0, 10);
}

export function computeHoldingStartDate(transactions: HoldingTransaction[]) {
  let start: string | null = null;
  for (const tx of transactions) {
    const qty = typeof tx.quantity === "string" ? Number(tx.quantity) : tx.quantity ?? 0;
    if (!Number.isFinite(qty) || qty <= 0) {
      continue;
    }
    if (tx.type !== "BUY" && tx.type !== "POSITION_SEED") {
      continue;
    }
    const date = normalizeDate(tx.trade_date);
    if (!date) {
      continue;
    }
    if (!start || date < start) {
      start = date;
    }
  }
  return start;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export type PriceRange = "90D" | "YTD" | "ALL";

export function resolvePriceRange(range: PriceRange, startDate: string | null, today: string) {
  if (range === "ALL") {
    return {
      from: startDate ?? today,
      to: today,
    };
  }
  if (range === "YTD") {
    const year = today.slice(0, 4);
    return {
      from: `${year}-01-01`,
      to: today,
    };
  }
  const from = formatDate(addDays(new Date(`${today}T00:00:00Z`), -90));
  return {
    from,
    to: today,
  };
}

export type LedgerRow = {
  trade_date: string;
  type: string;
  quantity: number | string | null;
};

export function computeRunningQuantity(rows: LedgerRow[]) {
  let running = 0;
  return rows.map((row) => {
    const qty = typeof row.quantity === "string" ? Number(row.quantity) : row.quantity ?? 0;
    const normalizedQty = Number.isFinite(qty) ? qty : 0;
    let delta = 0;
    if (row.type === "SELL") {
      delta = -normalizedQty;
    } else if (row.type === "BUY" || row.type === "POSITION_SEED" || row.type === "ADJUSTMENT" || row.type === "SPLIT") {
      delta = normalizedQty;
    }
    running += delta;
    return {
      ...row,
      running_quantity: running,
    };
  });
}

export type SeedAction = "insert" | "update" | "reject";

export function resolveSeedAction(existingTypes: string[]) {
  if (existingTypes.length === 0) {
    return "insert" as const;
  }
  const nonSeed = existingTypes.filter((type) => type !== "POSITION_SEED");
  if (nonSeed.length > 0) {
    return "reject" as const;
  }
  return "update" as const;
}
