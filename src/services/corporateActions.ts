import { query } from "../db";

export type DividendPayload = {
  date: string;
  dividend: number;
};

export type SplitPayload = {
  date: string;
  numerator: number;
  denominator: number;
};

export async function upsertDividend(
  listingId: number,
  payload: DividendPayload,
  currency: string | null,
  source: string,
  raw: Record<string, unknown> = {}
) {
  await query(
    `insert into dividends (listing_id, date, dividend, currency, raw, source)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (listing_id, date)
     do update set dividend = excluded.dividend, currency = excluded.currency, raw = excluded.raw`,
    [listingId, payload.date, payload.dividend, currency, raw, source]
  );
}

export async function upsertStockSplit(
  listingId: number,
  payload: SplitPayload,
  source: string,
  raw: Record<string, unknown> = {}
) {
  await query(
    `insert into stock_splits (listing_id, date, numerator, denominator, raw, source)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (listing_id, date)
     do update set numerator = excluded.numerator, denominator = excluded.denominator, raw = excluded.raw`,
    [listingId, payload.date, payload.numerator, payload.denominator, raw, source]
  );
}
