export type Holding = {
  quantity: number;
  avgCostBase: number;
};

export type CostBasisTransaction = {
  type: "BUY" | "SELL";
  quantity: number;
  price: number;
  fees: number;
};

export function applyTransaction(
  holding: Holding,
  tx: CostBasisTransaction,
  fxRate: number
) {
  if (!Number.isFinite(tx.quantity) || tx.quantity <= 0) {
    return;
  }

  if (tx.type === "BUY") {
    const costBase = (tx.price * tx.quantity + tx.fees) * fxRate;
    const totalCost = holding.avgCostBase * holding.quantity + costBase;
    const newQuantity = holding.quantity + tx.quantity;
    holding.quantity = newQuantity;
    holding.avgCostBase = newQuantity > 0 ? totalCost / newQuantity : 0;
    return;
  }

  if (tx.type === "SELL") {
    const newQuantity = holding.quantity - tx.quantity;
    holding.quantity = Math.max(0, newQuantity);
    if (holding.quantity === 0) {
      holding.avgCostBase = 0;
    }
  }
}
