export function formatMoney(value: number | null, currency?: string) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const normalized = currency?.toUpperCase().trim();
  if (normalized && /^[A-Z]{3}$/.test(normalized)) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: normalized,
        maximumFractionDigits: 2,
      }).format(value);
    } catch {
      // fall through to non-currency format
    }
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatScore(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(1);
}

export function formatNewsMatch(bases?: string[]) {
  if (!bases || bases.length === 0) {
    return "";
  }
  const normalized = bases.map((value) => value.toLowerCase());
  const order = ["ticker", "isin", "name"];
  const preferred = order.find((basis) => normalized.includes(basis));
  const label = preferred ?? normalized[0];
  return ` · ${label}`;
}

export function formatMetric(value: number | string | null) {
  if (value === null || value === undefined) {
    return "—";
  }
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) {
    return String(value);
  }
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
