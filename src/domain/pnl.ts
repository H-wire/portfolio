export function computeMarketValue(quantity: number, price: number | null, fxRate: number) {
  if (price === null) {
    return null;
  }
  return price * quantity * fxRate;
}

export function computeCostBasis(quantity: number, avgCostBase: number) {
  return avgCostBase * quantity;
}

export function computeTotalPnL(marketValue: number | null, costBasis: number) {
  if (marketValue === null) {
    return null;
  }
  return marketValue - costBasis;
}

export function computeDayChange(
  latestClose: number | null,
  previousClose: number | null,
  quantity: number,
  fxRate: number
) {
  if (latestClose === null || previousClose === null) {
    return null;
  }
  return (latestClose - previousClose) * quantity * fxRate;
}
