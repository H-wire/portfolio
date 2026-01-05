import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";
import { getMarketDataProvider } from "../marketdata";
import { resolvePriceRange } from "../domain/holdings";
import { getHoldingStartDate } from "../services/holdings";

const router = Router({ mergeParams: true });

const searchSchema = z.object({
  search: z.string().min(1),
  limit: z.string().optional(),
});

const priceSeedSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD."),
  close: z.number().positive(),
  volume: z.number().int().nonnegative().optional(),
});

const listingIdSchema = z.object({
  listingId: z.string().regex(/^\d+$/, "Invalid listing id."),
});

const fetchPricesSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

const priceRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  range: z.enum(["90D", "YTD", "ALL"]).optional(),
  portfolioId: z.string().regex(/^\d+$/, "Invalid portfolio id.").optional(),
});

const priceAvailabilitySchema = z.object({
  portfolioId: z.string().regex(/^\d+$/, "Invalid portfolio id."),
});

const backfillSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeDateValue(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return formatDate(value);
  }
  if (typeof value === "string") {
    return value.slice(0, 10);
  }
  return null;
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseLimit(value: string | undefined) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

async function logEvent(
  orgId: number,
  type: string,
  entityType: string,
  entityId: number | null,
  payload: Record<string, unknown>
) {
  await query(
    "insert into events (org_id, type, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5)",
    [orgId, type, entityType, entityId, payload]
  );
}

async function ensureListingInOrg(orgId: number, listingId: number) {
  const tx = await query<{ ok: number }>(
    "select 1 as ok from transactions where org_id = $1 and listing_id = $2 limit 1",
    [orgId, listingId]
  );
  if (tx.rows.length > 0) {
    return true;
  }
  const targets = await query<{ ok: number }>(
    "select 1 as ok from strategy_targets where org_id = $1 and listing_id = $2 limit 1",
    [orgId, listingId]
  );
  return targets.rows.length > 0;
}

router.get("/listings", async (req, res, next) => {
  try {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Missing search query");
    }

    const limit = parseLimit(parsed.data.limit);
    const search = `%${parsed.data.search.toLowerCase()}%`;

    const result = await query<{
      id: number;
      ticker: string;
      currency: string;
      active: boolean;
      instrument_id: number;
      instrument_name: string;
      exchange_id: number;
      exchange_name: string;
      exchange_mic: string | null;
    }>(
      `select
         listings.id,
         listings.ticker,
         listings.currency,
         listings.active,
         instruments.id as instrument_id,
         instruments.name as instrument_name,
         exchanges.id as exchange_id,
         exchanges.name as exchange_name,
         exchanges.mic_code as exchange_mic
       from listings
       join instruments on instruments.id = listings.instrument_id
       join exchanges on exchanges.id = listings.exchange_id
       where lower(listings.ticker) like $1 or lower(instruments.name) like $1
       order by listings.ticker asc
       limit $2`,
      [search, limit]
    );

    return sendData(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

router.get("/listings/:listingId/prices", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const params = listingIdSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid listing id");
    }

    const parsed = priceRangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid price range");
    }

    const listingId = Number(params.data.listingId);
    const allowed = await ensureListingInOrg(orgId, listingId);
    if (!allowed) {
      return sendError(res, 404, "NOT_FOUND", "Listing not found");
    }

    const today = formatDate(new Date());
    const range = parsed.data.range;
    const portfolioId = parsed.data.portfolioId ? Number(parsed.data.portfolioId) : null;

    let from: string | undefined = parsed.data.from;
    let to: string | undefined = parsed.data.to;

    if (range) {
      if (range === "ALL") {
        let startDate: string | null = null;
        if (portfolioId && Number.isFinite(portfolioId)) {
          startDate = await getHoldingStartDate(orgId, portfolioId, listingId);
        }
        if (!startDate) {
          const earliest = await query<{ date: string | null }>(
            "select min(date) as date from prices_eod where listing_id = $1",
            [listingId]
          );
          startDate = earliest.rows[0]?.date ? earliest.rows[0].date.slice(0, 10) : null;
        }
        const resolved = resolvePriceRange("ALL", startDate, today);
        if (startDate) {
          from = formatDate(addDays(new Date(`${startDate}T00:00:00Z`), -365));
        } else {
          from = resolved.from;
        }
        to = resolved.to;
      } else {
        const resolved = resolvePriceRange(range, null, today);
        from = resolved.from;
        to = resolved.to;
      }
    }

    if (!from || !to) {
      return sendError(res, 400, "VALIDATION_ERROR", "Missing from/to parameters");
    }

    const result = await query<{ date: string; close: string }>(
      "select date, close from prices_eod where listing_id = $1 and date between $2 and $3 order by date asc",
      [listingId, from, to]
    );

    return sendData(
      res,
      result.rows.map((row) => ({ date: row.date, close: Number(row.close) }))
    );
  } catch (err) {
    return next(err);
  }
});

router.get("/listings/:listingId/prices/availability", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const params = listingIdSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid listing id");
    }

    const parsed = priceAvailabilitySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Missing portfolio id");
    }

    const listingId = Number(params.data.listingId);
    const portfolioId = Number(parsed.data.portfolioId);
    const allowed = await ensureListingInOrg(orgId, listingId);
    if (!allowed) {
      return sendError(res, 404, "NOT_FOUND", "Listing not found");
    }

    const startDate = await getHoldingStartDate(orgId, portfolioId, listingId);
    const priceDates = await query<{ earliest: string | null; latest: string | null }>(
      "select min(date) as earliest, max(date) as latest from prices_eod where listing_id = $1",
      [listingId]
    );
    const earliestPriceDate = normalizeDateValue(priceDates.rows[0]?.earliest);
    const latestPriceDate = normalizeDateValue(priceDates.rows[0]?.latest);

    const missingFromStart = Boolean(
      startDate && (!earliestPriceDate || earliestPriceDate > startDate)
    );

    return sendData(res, {
      start_date: startDate,
      earliest_price_date: earliestPriceDate,
      latest_price_date: latestPriceDate,
      missing_from_start: missingFromStart,
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/listings/:listingId/prices/backfill", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const params = listingIdSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid listing id");
    }

    const payload = backfillSchema.safeParse(req.body ?? {});
    if (!payload.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid backfill payload");
    }

    const listingId = Number(params.data.listingId);
    const allowed = await ensureListingInOrg(orgId, listingId);
    if (!allowed) {
      return sendError(res, 404, "NOT_FOUND", "Listing not found");
    }

    const listingResult = await query<{ id: number; ticker: string }>(
      "select id, ticker from listings where id = $1",
      [listingId]
    );
    const listing = listingResult.rows[0];
    if (!listing) {
      return sendError(res, 404, "NOT_FOUND", "Listing not found");
    }

    const from = payload.data.from;
    const to = payload.data.to ?? formatDate(new Date());

    const provider = getMarketDataProvider();
    let prices;
    try {
      prices = await provider.fetchPrices([listing.ticker], from, to);
    } catch (err) {
      const detailMessage = err instanceof Error ? err.message : "Unknown error";
      const details = process.env.NODE_ENV === "production" ? undefined : [{ message: detailMessage }];
      return sendError(res, 502, "MARKET_DATA_ERROR", "Market data provider unavailable", details);
    }

    let inserted = 0;
    let updated = 0;
    const errors: Array<{ date: string; error: string }> = [];

    for (const price of prices) {
      try {
        const result = await query<{ inserted: boolean }>(
          "insert into prices_eod (listing_id, date, open, high, low, close, adj_close, volume) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (listing_id, date) do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, adj_close = excluded.adj_close, volume = excluded.volume returning (xmax = 0) as inserted",
          [
            listingId,
            price.date,
            price.open,
            price.high,
            price.low,
            price.close,
            price.adj_close ?? null,
            price.volume,
          ]
        );
        if (result.rows[0]?.inserted) {
          inserted += 1;
        } else {
          updated += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push({ date: price.date, error: message });
      }
    }

    await logEvent(orgId, "PRICE_BACKFILL", "listing", listingId, {
      listing_id: listingId,
      from,
      to,
      inserted,
      updated,
      errors,
    });

    return sendData(res, {
      listing_id: listingId,
      ticker: listing.ticker,
      from,
      to,
      inserted,
      updated,
      errors,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/listings/:listingId/fundamentals/latest", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const params = listingIdSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid listing id");
    }

    const listingId = Number(params.data.listingId);
    const allowed = await ensureListingInOrg(orgId, listingId);
    if (!allowed) {
      return sendError(res, 404, "NOT_FOUND", "Listing not found");
    }

    const result = await query<{
      instrument_id: number;
      as_of_date: string;
      revenue_ttm: string | null;
      eps_ttm: string | null;
      ebitda_ttm: string | null;
      net_income_ttm: string | null;
      income_tax_expense_ttm: string | null;
      operating_cashflow_ttm: string | null;
      capital_expenditure_ttm: string | null;
      ebit_ttm: string | null;
      tax_rate: string | null;
      total_debt: string | null;
      total_equity: string | null;
      cash_and_equivalents: string | null;
      shares_outstanding: string | null;
      raw: Record<string, unknown>;
      source: string;
      created_at: Date;
    }>(
      `select f.instrument_id,
              f.as_of_date,
              f.revenue_ttm,
              f.eps_ttm,
              f.ebitda_ttm,
              f.net_income_ttm,
              f.income_tax_expense_ttm,
              f.operating_cashflow_ttm,
              f.capital_expenditure_ttm,
              f.ebit_ttm,
              f.tax_rate,
              f.total_debt,
              f.total_equity,
              f.cash_and_equivalents,
              f.shares_outstanding,
              f.raw,
              f.source,
              f.created_at
       from listings l
       join fundamentals_ttm f on f.instrument_id = l.instrument_id
       where l.id = $1
       order by f.as_of_date desc, f.created_at desc
       limit 1`,
      [listingId]
    );

    return sendData(res, result.rows[0] ?? null);
  } catch (err) {
    return next(err);
  }
});

router.post("/listings/:listingId/prices/seed", async (req, res, next) => {
  try {
    const params = listingIdSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid listing id");
    }

    const payload = priceSeedSchema.safeParse(req.body);
    if (!payload.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid price payload");
    }

    const listingId = Number(params.data.listingId);
    const { date, close, volume } = payload.data;

    const result = await query<{
      listing_id: number;
      date: string;
      close: number;
      volume: number | null;
    }>(
      `insert into prices_eod (listing_id, date, open, high, low, close, adj_close, volume)
       values ($1, $2, $3, $3, $3, $3, $3, $4)
       on conflict (listing_id, date)
       do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, adj_close = excluded.adj_close, volume = excluded.volume
       returning listing_id, date, close, volume`,
      [listingId, date, close, volume ?? null]
    );

    return sendData(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post("/listings/:listingId/prices/fetch", async (req, res, next) => {
  try {
    const params = listingIdSchema.safeParse(req.params);
    if (!params.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid listing id");
    }

    const payload = fetchPricesSchema.safeParse(req.body ?? {});
    if (!payload.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid fetch payload");
    }

    const listingId = Number(params.data.listingId);
    const days = payload.data.days ?? 10;

    const listingResult = await query<{ id: number; ticker: string }>(
      "select id, ticker from listings where id = $1",
      [listingId]
    );
    const listing = listingResult.rows[0];
    if (!listing) {
      return sendError(res, 404, "NOT_FOUND", "Listing not found");
    }

    const provider = getMarketDataProvider();
    const to = formatDate(new Date());
    const from = formatDate(addDays(new Date(), -days));

    let prices;
    try {
      prices = await provider.fetchPrices([listing.ticker], from, to);
    } catch (err) {
      const detailMessage = err instanceof Error ? err.message : "Unknown error";
      const details = process.env.NODE_ENV === "production" ? undefined : [{ message: detailMessage }];
      return sendError(res, 502, "MARKET_DATA_ERROR", "Market data provider unavailable", details);
    }
    for (const price of prices) {
      await query(
        "insert into prices_eod (listing_id, date, open, high, low, close, adj_close, volume) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (listing_id, date) do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, adj_close = excluded.adj_close, volume = excluded.volume",
        [
          listingId,
          price.date,
          price.open,
          price.high,
          price.low,
          price.close,
          price.adj_close ?? null,
          price.volume,
        ]
      );
    }

    return sendData(res, {
      listing_id: listingId,
      ticker: listing.ticker,
      from,
      to,
      inserted: prices.length,
    });
  } catch (err) {
    return next(err);
  }
});

export { router as listingsRouter };
