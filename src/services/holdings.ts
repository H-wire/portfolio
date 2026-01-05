import { query } from "../db";

export async function getHoldingStartDate(
  orgId: number,
  portfolioId: number,
  listingId: number
): Promise<string | null> {
  const result = await query<{ start_date: string | null }>(
    "select min(trade_date) as start_date from transactions where org_id = $1 and portfolio_id = $2 and listing_id = $3 and type in ('BUY', 'POSITION_SEED') and quantity > 0",
    [orgId, portfolioId, listingId]
  );
  const value = result.rows[0]?.start_date ?? null;
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return null;
}
