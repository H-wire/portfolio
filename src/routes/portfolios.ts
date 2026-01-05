import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";
import { getMarketDataProvider } from "../marketdata";
import { computeRunningQuantity, resolveSeedAction } from "../domain/holdings";

const router = Router({ mergeParams: true });

const portfolioCreateSchema = z.object({
  name: z.string().min(1),
  base_currency: z.string().min(3).max(10),
});

const portfolioUpdateSchema = portfolioCreateSchema.partial();

const transactionCreateSchema = z.object({
  listing_id: z.number().int().positive(),
  trade_date: z.string().min(10),
  type: z.enum(["BUY", "SELL", "DIVIDEND", "FEE", "SPLIT", "POSITION_SEED"]),
  quantity: z.number().positive(),
  price: z.number().positive().nullable().optional(),
  currency: z.string().min(3).max(10),
  fees: z.number().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  account_id: z.number().int().positive().nullable().optional(),
});

const seedPositionSchema = z.object({
  quantity: z.number().positive(),
  avg_cost: z.number().positive(),
  cost_currency: z.string().min(3).max(10),
  first_buy_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(2000).nullable().optional(),
});

const transactionUpdateSchema = transactionCreateSchema.partial();

const fetchPricesSchema = z.object({
  days: z.number().int().min(1).max(365).optional(),
});

const fetchFxSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function parseLimit(value: unknown) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function parseCursor(value: unknown) {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

async function ensurePortfolio(orgId: number, portfolioId: number) {
  const result = await query<{ id: number }>(
    "select id from portfolios where id = $1 and org_id = $2",
    [portfolioId, orgId]
  );
  return result.rows[0] ?? null;
}

async function ensureAccount(orgId: number, accountId: number) {
  const result = await query<{ id: number }>(
    "select id from accounts where id = $1 and org_id = $2",
    [accountId, orgId]
  );
  return result.rows[0] ?? null;
}

async function ensureListing(listingId: number) {
  const result = await query<{ id: number }>(
    "select id from listings where id = $1",
    [listingId]
  );
  return result.rows[0] ?? null;
}

async function fetchHistoricalPricesIfNeeded(listingId: number, orgId: number) {
  try {
    // Check if we already have price data for this listing
    const priceCheck = await query<{ count: string }>(
      "select count(*) as count from prices_eod where listing_id = $1",
      [listingId]
    );
    const priceCount = Number(priceCheck.rows[0]?.count ?? 0);
    
    // If we already have prices, skip fetching
    if (priceCount > 0) {
      return;
    }

    // Get listing ticker information
    const listingResult = await query<{ id: number; ticker: string }>(
      "select id, ticker from listings where id = $1",
      [listingId]
    );
    const listing = listingResult.rows[0];
    if (!listing) {
      return;
    }

    // Fetch historical prices (past 365 days)
    const provider = getMarketDataProvider();
    const today = formatDate(new Date());
    const from = formatDate(addDays(new Date(), -365));

    const prices = await provider.fetchPrices([listing.ticker], from, today);
    
    if (prices.length === 0) {
      await logEvent(orgId, "price_fetch_empty", "listing", listingId, "No historical prices found", {
        ticker: listing.ticker,
        from,
        to: today,
      });
      return;
    }

    // Insert all historical prices
    let inserted = 0;
    for (const price of prices) {
      await query(
        "insert into prices_eod (listing_id, date, open, high, low, close, volume) values ($1, $2, $3, $4, $5, $6, $7) on conflict (listing_id, date) do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume",
        [
          listing.id,
          price.date,
          price.open,
          price.high,
          price.low,
          price.close,
          price.volume,
        ]
      );
      inserted += 1;
    }

    await logEvent(orgId, "price_fetch_success", "listing", listingId, `Fetched ${inserted} historical prices`, {
      ticker: listing.ticker,
      inserted,
      from,
      to: today,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await logEvent(orgId, "price_fetch_failed", "listing", listingId, `Failed to fetch prices: ${message}`, {
      error: message,
    });
  }
}

async function logEvent(
  orgId: number,
  type: string,
  entityType: string,
  entityId: number | null,
  summary: string,
  payload?: Record<string, unknown>
) {
  await query(
    "insert into events (org_id, type, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5)",
    [orgId, type, entityType, entityId, {
      source: "api",
      status: "ok",
      summary,
      ...payload,
    }]
  );
}

router.get("/portfolios", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);

    const params: Array<number> = [orgId, limit + 1];
    let cursorFilter = "";
    if (cursor) {
      params.push(cursor);
      cursorFilter = "and id > $3";
    }

    const result = await query<{
      id: number;
      name: string;
      base_currency: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, name, base_currency, created_at, updated_at
       from portfolios
       where org_id = $1 ${cursorFilter}
       order by id asc
       limit $2`,
      params
    );

    const rows = result.rows.slice(0, limit);
    const nextCursor = result.rows.length > limit ? rows[rows.length - 1]?.id ?? null : null;

    return sendData(res, rows, { cursor: nextCursor });
  } catch (err) {
    return next(err);
  }
});

router.post("/portfolios", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const payload = portfolioCreateSchema.parse(req.body);

    const result = await query<{
      id: number;
      name: string;
      base_currency: string;
      created_at: Date;
      updated_at: Date;
    }>(
      "insert into portfolios (org_id, name, base_currency) values ($1, $2, $3) returning id, name, base_currency, created_at, updated_at",
      [orgId, payload.name, payload.base_currency]
    );

    await logEvent(orgId, "portfolio_created", "portfolio", result.rows[0].id, "Portfolio created");

    return res.status(201).json({
      data: result.rows[0],
      meta: {
        estimated: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/portfolios/:portfolioId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const result = await query<{
      id: number;
      name: string;
      base_currency: string;
      created_at: Date;
      updated_at: Date;
    }>(
      "select id, name, base_currency, created_at, updated_at from portfolios where id = $1 and org_id = $2",
      [portfolioId, orgId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    return sendData(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.put("/portfolios/:portfolioId/positions/:listingId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    const listingId = Number(req.params.listingId);
    if (!Number.isFinite(portfolioId) || !Number.isFinite(listingId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio or listing id");
    }

    const payload = seedPositionSchema.parse(req.body);

    const portfolio = await ensurePortfolio(orgId, portfolioId);
    if (!portfolio) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    const listing = await ensureListing(listingId);
    if (!listing) {
      return sendError(res, 404, "NOT_FOUND", "Listing not found");
    }

    const existing = await query<{ id: number; type: string; created_at: Date }>(
      "select id, type, created_at from transactions where org_id = $1 and portfolio_id = $2 and listing_id = $3",
      [orgId, portfolioId, listingId]
    );

    const action = resolveSeedAction(existing.rows.map((row) => row.type));
    if (action === "reject") {
      return sendError(
        res,
        409,
        "CONFLICT",
        "Cannot seed because existing transactions exist. View ledger or create an adjustment."
      );
    }

    let result;
    if (action === "update") {
      const seedRows = existing.rows
        .filter((row) => row.type === "POSITION_SEED")
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
      const seedId = seedRows[0]?.id;
      if (!seedId) {
        return sendError(res, 409, "CONFLICT", "Cannot seed because existing transactions exist.");
      }

      result = await query<{
        id: number;
        listing_id: number;
        trade_date: string;
        type: string;
        quantity: string;
        price: string | null;
        currency: string;
        fees: string | null;
        notes: string | null;
        account_id: number | null;
        created_at: Date;
        updated_at: Date;
      }>(
        "update transactions set trade_date = $1, quantity = $2, price = $3, currency = $4, notes = $5, updated_at = now() where id = $6 and org_id = $7 and portfolio_id = $8 returning id, listing_id, trade_date, type, quantity, price, currency, fees, notes, account_id, created_at, updated_at",
        [
          payload.first_buy_date,
          payload.quantity,
          payload.avg_cost,
          payload.cost_currency,
          payload.notes ?? null,
          seedId,
          orgId,
          portfolioId,
        ]
      );

      const extraSeedIds = seedRows.slice(1).map((row) => row.id);
      if (extraSeedIds.length > 0) {
        await query(
          "delete from transactions where org_id = $1 and portfolio_id = $2 and listing_id = $3 and id = any($4)",
          [orgId, portfolioId, listingId, extraSeedIds]
        );
      }
    } else {
      result = await query<{
        id: number;
        listing_id: number;
        trade_date: string;
        type: string;
        quantity: string;
        price: string | null;
        currency: string;
        fees: string | null;
        notes: string | null;
        account_id: number | null;
        created_at: Date;
        updated_at: Date;
      }>(
        "insert into transactions (org_id, portfolio_id, account_id, listing_id, trade_date, type, quantity, price, currency, fees, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id, listing_id, trade_date, type, quantity, price, currency, fees, notes, account_id, created_at, updated_at",
        [
          orgId,
          portfolioId,
          null,
          listingId,
          payload.first_buy_date,
          "POSITION_SEED",
          payload.quantity,
          payload.avg_cost,
          payload.cost_currency,
          0,
          payload.notes ?? null,
        ]
      );
    }

    await logEvent(orgId, "POSITION_SEEDED", "portfolio", portfolioId, "Position seeded", {
      listing_id: listingId,
      quantity: payload.quantity,
      avgCost: payload.avg_cost,
      firstBuyDate: payload.first_buy_date,
      action,
    });

    return sendData(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.put("/portfolios/:portfolioId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const payload = portfolioUpdateSchema.parse(req.body);
    if (!payload.name && !payload.base_currency) {
      return sendError(res, 400, "VALIDATION_ERROR", "No fields to update");
    }

    const result = await query<{
      id: number;
      name: string;
      base_currency: string;
      created_at: Date;
      updated_at: Date;
    }>(
      "update portfolios set name = coalesce($1, name), base_currency = coalesce($2, base_currency), updated_at = now() where id = $3 and org_id = $4 returning id, name, base_currency, created_at, updated_at",
      [payload.name ?? null, payload.base_currency ?? null, portfolioId, orgId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    await logEvent(orgId, "portfolio_updated", "portfolio", portfolioId, "Portfolio updated");

    return sendData(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete("/portfolios/:portfolioId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const result = await query<{ id: number }>(
      "delete from portfolios where id = $1 and org_id = $2 returning id",
      [portfolioId, orgId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    await logEvent(orgId, "portfolio_deleted", "portfolio", portfolioId, "Portfolio deleted");

    return sendData(res, { ok: true });
  } catch (err) {
    return next(err);
  }
});

router.get("/portfolios/:portfolioId/transactions", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const portfolio = await ensurePortfolio(orgId, portfolioId);
    if (!portfolio) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);

    const params: Array<number> = [orgId, portfolioId, limit + 1];
    let cursorFilter = "";
    if (cursor) {
      params.push(cursor);
      cursorFilter = "and id > $4";
    }

    const result = await query<{
      id: number;
      listing_id: number;
      trade_date: string;
      type: string;
      quantity: string;
      price: string | null;
      currency: string;
      fees: string | null;
      notes: string | null;
      account_id: number | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, listing_id, trade_date, type, quantity, price, currency, fees, notes, account_id, created_at, updated_at
       from transactions
       where org_id = $1 and portfolio_id = $2 ${cursorFilter}
       order by id asc
       limit $3`,
      params
    );

    const rows = result.rows.slice(0, limit);
    const nextCursor = result.rows.length > limit ? rows[rows.length - 1]?.id ?? null : null;

    return sendData(res, rows, { cursor: nextCursor });
  } catch (err) {
    return next(err);
  }
});

router.get("/portfolios/:portfolioId/holdings/:listingId/transactions", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    const listingId = Number(req.params.listingId);
    if (!Number.isFinite(portfolioId) || !Number.isFinite(listingId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio or listing id");
    }

    const portfolio = await ensurePortfolio(orgId, portfolioId);
    if (!portfolio) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    const result = await query<{
      id: number;
      trade_date: string;
      type: string;
      quantity: string;
      price: string | null;
      currency: string;
      fees: string | null;
      notes: string | null;
      created_at: Date;
    }>(
      `select id, trade_date, type, quantity, price, currency, fees, notes, created_at
       from transactions
       where org_id = $1 and portfolio_id = $2 and listing_id = $3
       order by trade_date asc, created_at asc`,
      [orgId, portfolioId, listingId]
    );

    const normalized = result.rows.map((row) => ({
      id: row.id,
      trade_date: row.trade_date,
      type: row.type,
      quantity: Number(row.quantity),
      price: row.price === null ? null : Number(row.price),
      currency: row.currency,
      fees: row.fees === null ? null : Number(row.fees),
      notes: row.notes,
      created_at: row.created_at,
    }));

    const withRunning = computeRunningQuantity(normalized);

    return sendData(res, withRunning);
  } catch (err) {
    return next(err);
  }
});

router.post("/portfolios/:portfolioId/transactions", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const payload = transactionCreateSchema.parse(req.body);

    const portfolio = await ensurePortfolio(orgId, portfolioId);
    if (!portfolio) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    const listing = await ensureListing(payload.listing_id);
    if (!listing) {
      return sendError(res, 400, "VALIDATION_ERROR", "Listing not found");
    }

    if (payload.account_id) {
      const account = await ensureAccount(orgId, payload.account_id);
      if (!account) {
        return sendError(res, 400, "VALIDATION_ERROR", "Account not found in org");
      }
    }

    const result = await query<{
      id: number;
      listing_id: number;
      trade_date: string;
      type: string;
      quantity: string;
      price: string | null;
      currency: string;
      fees: string | null;
      notes: string | null;
      account_id: number | null;
      created_at: Date;
      updated_at: Date;
    }>(
      "insert into transactions (org_id, portfolio_id, account_id, listing_id, trade_date, type, quantity, price, currency, fees, notes) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id, listing_id, trade_date, type, quantity, price, currency, fees, notes, account_id, created_at, updated_at",
      [
        orgId,
        portfolioId,
        payload.account_id ?? null,
        payload.listing_id,
        payload.trade_date,
        payload.type,
        payload.quantity,
        payload.price ?? null,
        payload.currency,
        payload.fees ?? null,
        payload.notes ?? null,
      ]
    );

    await logEvent(orgId, "transaction_created", "transaction", result.rows[0].id, "Transaction created");

    // Automatically fetch historical prices for this listing if no prices exist
    fetchHistoricalPricesIfNeeded(payload.listing_id, orgId).catch((err) => {
      console.error(`Background price fetch failed for listing ${payload.listing_id}:`, err);
    });

    return res.status(201).json({
      data: result.rows[0],
      meta: {
        estimated: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.put("/portfolios/:portfolioId/transactions/:transactionId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    const transactionId = Number(req.params.transactionId);
    if (!Number.isFinite(portfolioId) || !Number.isFinite(transactionId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio or transaction id");
    }

    const payload = transactionUpdateSchema.parse(req.body);
    if (Object.keys(payload).length === 0) {
      return sendError(res, 400, "VALIDATION_ERROR", "No fields to update");
    }

    if (payload.account_id) {
      const account = await ensureAccount(orgId, payload.account_id);
      if (!account) {
        return sendError(res, 400, "VALIDATION_ERROR", "Account not found in org");
      }
    }

    if (payload.listing_id) {
      const listing = await ensureListing(payload.listing_id);
      if (!listing) {
        return sendError(res, 400, "VALIDATION_ERROR", "Listing not found");
      }
    }

    const result = await query<{
      id: number;
      listing_id: number;
      trade_date: string;
      type: string;
      quantity: string;
      price: string | null;
      currency: string;
      fees: string | null;
      notes: string | null;
      account_id: number | null;
      created_at: Date;
      updated_at: Date;
    }>(
      "update transactions set listing_id = coalesce($1, listing_id), trade_date = coalesce($2, trade_date), type = coalesce($3, type), quantity = coalesce($4, quantity), price = coalesce($5, price), currency = coalesce($6, currency), fees = coalesce($7, fees), notes = coalesce($8, notes), account_id = coalesce($9, account_id), updated_at = now() where id = $10 and org_id = $11 and portfolio_id = $12 returning id, listing_id, trade_date, type, quantity, price, currency, fees, notes, account_id, created_at, updated_at",
      [
        payload.listing_id ?? null,
        payload.trade_date ?? null,
        payload.type ?? null,
        payload.quantity ?? null,
        payload.price ?? null,
        payload.currency ?? null,
        payload.fees ?? null,
        payload.notes ?? null,
        payload.account_id ?? null,
        transactionId,
        orgId,
        portfolioId,
      ]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Transaction not found");
    }

    await logEvent(orgId, "transaction_updated", "transaction", transactionId, "Transaction updated");

    return sendData(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete("/portfolios/:portfolioId/transactions/:transactionId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    const transactionId = Number(req.params.transactionId);
    if (!Number.isFinite(portfolioId) || !Number.isFinite(transactionId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio or transaction id");
    }

    const existing = await query<{
      id: number;
      listing_id: number;
      trade_date: string;
      type: string;
      quantity: string;
      price: string | null;
      currency: string;
      fees: string | null;
      notes: string | null;
      account_id: number | null;
      created_at: Date;
    }>(
      "select id, listing_id, trade_date, type, quantity, price, currency, fees, notes, account_id, created_at from transactions where id = $1 and org_id = $2 and portfolio_id = $3",
      [transactionId, orgId, portfolioId]
    );

    if (existing.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Transaction not found");
    }

    await query(
      "delete from transactions where id = $1 and org_id = $2 and portfolio_id = $3",
      [transactionId, orgId, portfolioId]
    );

    await logEvent(orgId, "TRANSACTION_DELETED", "transaction", transactionId, "Transaction deleted", {
      transaction: existing.rows[0],
    });

    return sendData(res, { ok: true, transaction: existing.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.post("/portfolios/:portfolioId/prices/fetch", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const parsed = fetchPricesSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid fetch payload");
    }

    const portfolio = await ensurePortfolio(orgId, portfolioId);
    if (!portfolio) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    const listingsResult = await query<{ id: number; ticker: string }>(
      `select distinct listings.id, listings.ticker
       from transactions
       join listings on listings.id = transactions.listing_id
       where transactions.org_id = $1 and transactions.portfolio_id = $2`,
      [orgId, portfolioId]
    );

    if (listingsResult.rows.length === 0) {
      return sendData(res, { inserted: 0, listings: 0 });
    }

    const provider = getMarketDataProvider();
    const days = parsed.data.days ?? 10;
    const to = formatDate(new Date());
    const from = formatDate(addDays(new Date(), -days));

    const tickerToListing = new Map(
      listingsResult.rows.map((row) => [row.ticker, row.id])
    );

    let prices;
    try {
      prices = await provider.fetchPrices(
        listingsResult.rows.map((row) => row.ticker),
        from,
        to
      );
    } catch (err) {
      const detailMessage = err instanceof Error ? err.message : "Unknown error";
      const details = process.env.NODE_ENV === "production" ? undefined : [{ message: detailMessage }];
      return sendError(res, 502, "MARKET_DATA_ERROR", "Market data provider unavailable", details);
    }

    let inserted = 0;
    for (const price of prices) {
      const listingId = tickerToListing.get(price.ticker);
      if (!listingId) {
        continue;
      }
      await query(
        "insert into prices_eod (listing_id, date, open, high, low, close, volume) values ($1, $2, $3, $4, $5, $6, $7) on conflict (listing_id, date) do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, volume = excluded.volume",
        [
          listingId,
          price.date,
          price.open,
          price.high,
          price.low,
          price.close,
          price.volume,
        ]
      );
      inserted += 1;
    }

    return sendData(res, {
      listings: listingsResult.rows.length,
      inserted,
      from,
      to,
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/portfolios/:portfolioId/fx-rates/fetch", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const parsed = fetchFxSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid FX fetch payload");
    }

    const portfolioResult = await query<{ id: number; base_currency: string }>(
      "select id, base_currency from portfolios where id = $1 and org_id = $2",
      [portfolioId, orgId]
    );

    const portfolio = portfolioResult.rows[0];
    if (!portfolio) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    const currenciesResult = await query<{ currency: string }>(
      "select distinct currency from transactions where org_id = $1 and portfolio_id = $2",
      [orgId, portfolioId]
    );

    const pairs = currenciesResult.rows
      .map((row) => row.currency)
      .filter((currency) => currency && currency !== portfolio.base_currency)
      .map((currency) => `${currency}${portfolio.base_currency}`);

    const date = parsed.data.date ?? formatDate(addDays(new Date(), -1));
    if (pairs.length === 0) {
      return sendData(res, { pairs: 0, inserted: 0, date });
    }

    const provider = getMarketDataProvider();
    let rates;
    try {
      rates = await provider.fetchFXRates(pairs, date);
    } catch (err) {
      const detailMessage = err instanceof Error ? err.message : "Unknown error";
      const details = process.env.NODE_ENV === "production" ? undefined : [{ message: detailMessage }];
      return sendError(res, 502, "MARKET_DATA_ERROR", "Market data provider unavailable", details);
    }

    let inserted = 0;
    for (const rate of rates) {
      const normalized = rate.pair.replace("/", "").toUpperCase();
      if (normalized.length < 6) {
        continue;
      }
      const base = normalized.slice(0, 3);
      const quote = normalized.slice(3, 6);
      const rateDate = rate.date ?? date;
      await query(
        "insert into fx_rates_eod (date, base_currency, quote_currency, rate) values ($1, $2, $3, $4) on conflict (date, base_currency, quote_currency) do update set rate = excluded.rate",
        [rateDate, base, quote, rate.rate]
      );
      inserted += 1;
    }

    return sendData(res, {
      pairs: pairs.length,
      inserted,
      date,
    });
  } catch (err) {
    return next(err);
  }
});

export { router as portfoliosRouter };
