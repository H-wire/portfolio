import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";
import { requireOrgRole } from "../middleware/roles";

const router = Router({ mergeParams: true });

const instrumentCreateSchema = z.object({
  isin: z.string().min(6).max(32).nullable().optional(),
  name: z.string().min(1),
  asset_type: z.string().min(1),
  sector: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  listing: z.object({
    exchange_id: z.number().int().positive(),
    ticker: z.string().min(1),
    currency: z.string().min(3).max(10),
    active: z.boolean().optional(),
  }),
});

router.post("/instruments", requireOrgRole(["owner", "admin"]), async (req, res, next) => {
  try {
    const payload = instrumentCreateSchema.parse(req.body);

    const exchange = await query<{ id: number }>(
      "select id from exchanges where id = $1",
      [payload.listing.exchange_id]
    );
    if (exchange.rows.length === 0) {
      return sendError(res, 400, "VALIDATION_ERROR", "Exchange not found");
    }

    const existingListing = await query<{
      listing_id: number;
      listing_exchange_id: number;
      listing_ticker: string;
      listing_currency: string;
      listing_active: boolean;
      instrument_id: number;
      instrument_isin: string | null;
      instrument_name: string;
      instrument_asset_type: string;
      instrument_sector: string | null;
      instrument_country: string | null;
      instrument_metadata: Record<string, unknown>;
    }>(
      `select
        listings.id as listing_id,
        listings.exchange_id as listing_exchange_id,
        listings.ticker as listing_ticker,
        listings.currency as listing_currency,
        listings.active as listing_active,
        instruments.id as instrument_id,
        instruments.isin as instrument_isin,
        instruments.name as instrument_name,
        instruments.asset_type as instrument_asset_type,
        instruments.sector as instrument_sector,
        instruments.country as instrument_country,
        instruments.metadata as instrument_metadata
      from listings
      join instruments on instruments.id = listings.instrument_id
      where listings.exchange_id = $1 and lower(listings.ticker) = lower($2)
      limit 1`,
      [payload.listing.exchange_id, payload.listing.ticker]
    );

    if (existingListing.rows.length > 0) {
      const row = existingListing.rows[0];
      return sendData(res, {
        instrument: {
          id: row.instrument_id,
          isin: row.instrument_isin,
          name: row.instrument_name,
          asset_type: row.instrument_asset_type,
          sector: row.instrument_sector,
          country: row.instrument_country,
          metadata: row.instrument_metadata,
        },
        listing: {
          id: row.listing_id,
          instrument_id: row.instrument_id,
          exchange_id: row.listing_exchange_id,
          ticker: row.listing_ticker,
          currency: row.listing_currency,
          active: row.listing_active,
        },
      });
    }

    const instrumentResult = await query<{
      id: number;
      isin: string | null;
      name: string;
      asset_type: string;
      sector: string | null;
      country: string | null;
      metadata: Record<string, unknown>;
    }>(
      "insert into instruments (isin, name, asset_type, sector, country, metadata) values ($1, $2, $3, $4, $5, $6) returning id, isin, name, asset_type, sector, country, metadata",
      [
        payload.isin ?? null,
        payload.name,
        payload.asset_type,
        payload.sector ?? null,
        payload.country ?? null,
        payload.metadata ?? {},
      ]
    );

    const listingResult = await query<{
      id: number;
      instrument_id: number;
      exchange_id: number;
      ticker: string;
      currency: string;
      active: boolean;
    }>(
      "insert into listings (instrument_id, exchange_id, ticker, currency, active) values ($1, $2, $3, $4, $5) returning id, instrument_id, exchange_id, ticker, currency, active",
      [
        instrumentResult.rows[0].id,
        payload.listing.exchange_id,
        payload.listing.ticker,
        payload.listing.currency,
        payload.listing.active ?? true,
      ]
    );

    return res.status(201).json({
      data: {
        instrument: instrumentResult.rows[0],
        listing: listingResult.rows[0],
      },
      meta: {
        estimated: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
});

export { router as instrumentsRouter };
