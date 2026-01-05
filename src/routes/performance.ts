import { Router } from "express";
import { computeCostBasis, computeDayChange, computeMarketValue, computeTotalPnL } from "../domain/pnl";
import { applyTransaction, type CostBasisTransaction } from "../domain/costBasis";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";

type TransactionRow = {
  id: number;
  listing_id: number;
  trade_date: string | Date;
  type: string;
  quantity: string;
  price: string | null;
  currency: string;
  fees: string | null;
};

type ListingInfo = {
  id: number;
  ticker: string;
  currency: string;
  instrument_id: number;
  instrument_name: string;
  sector: string | null;
};

type PriceRow = {
  listing_id: number;
  date: string;
  close: string;
  rn?: number;
};

type FxRateRow = {
  base_currency: string;
  quote_currency: string;
  date: string;
  rate: string;
};

const router = Router({ mergeParams: true });

const dateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

function toDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function normalizeDateKey(value: string | Date) {
  if (value instanceof Date) {
    return formatDate(value);
  }
  return value.slice(0, 10);
}

function previousDateKey(value: string) {
  return formatDate(addDays(toDate(value), -1));
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function listDates(from: string, to: string) {
  const dates: string[] = [];
  let cursor = toDate(from);
  const end = toDate(to);
  while (cursor <= end) {
    dates.push(formatDate(cursor));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

async function loadPortfolio(orgId: number, portfolioId: number) {
  const result = await query<{ id: number; base_currency: string }>(
    "select id, base_currency from portfolios where id = $1 and org_id = $2",
    [portfolioId, orgId]
  );
  return result.rows[0] ?? null;
}

async function loadTransactions(orgId: number, portfolioId: number, toDateValue: string) {
  const result = await query<TransactionRow>(
    "select id, listing_id, trade_date, type, quantity, price, currency, fees from transactions where org_id = $1 and portfolio_id = $2 and trade_date <= $3 order by trade_date asc, id asc",
    [orgId, portfolioId, toDateValue]
  );
  return result.rows;
}

function normalizeTransaction(tx: TransactionRow): CostBasisTransaction | null {
  const quantity = Number(tx.quantity);
  const price = tx.price ? Number(tx.price) : 0;
  const fees = tx.fees ? Number(tx.fees) : 0;

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return {
    type: tx.type === "SELL" ? "SELL" : "BUY",
    quantity,
    price,
    fees,
  };
}

function buildHoldings(
  transactions: TransactionRow[],
  fxLookup: (currency: string, date: string) => Promise<{ rate: number; estimated: boolean; stale: boolean } | null>,
  baseCurrency: string
) {
  const holdings = new Map<number, { quantity: number; avgCostBase: number }>();
  const warnings: string[] = [];
  let estimated = false;

  return transactions.reduce(async (pending, tx) => {
    await pending;
    const holding = holdings.get(tx.listing_id) ?? { quantity: 0, avgCostBase: 0 };
    const tradeDate = normalizeDateKey(tx.trade_date);
    const currency = tx.currency;
    let rate = 1;
    if (currency !== baseCurrency) {
      const fx = await fxLookup(currency, tradeDate);
      if (!fx) {
        warnings.push(`Missing FX rate for ${currency}/${baseCurrency} on ${tradeDate}`);
        estimated = true;
        rate = 1;
      } else {
        rate = fx.rate;
        if (fx.estimated) {
          estimated = true;
        }
        if (fx.stale) {
          warnings.push(`FX rate for ${currency}/${baseCurrency} is older than 7 days at ${tradeDate}`);
        }
      }
    }

    const normalized = normalizeTransaction(tx);
    if (!normalized) {
      return;
    }
    applyTransaction(holding, normalized, rate);
    if (holding.quantity > 0) {
      holdings.set(tx.listing_id, holding);
    } else {
      holdings.delete(tx.listing_id);
    }
  }, Promise.resolve()).then(() => ({ holdings, warnings, estimated }));
}

async function loadListingInfo(listingIds: number[]) {
  if (listingIds.length === 0) {
    return [];
  }
  const result = await query<ListingInfo>(
    "select listings.id, listings.ticker, listings.currency, instruments.id as instrument_id, instruments.name as instrument_name, instruments.sector from listings join instruments on instruments.id = listings.instrument_id where listings.id = any($1)",
    [listingIds]
  );
  return result.rows;
}

async function loadLatestPrices(listingIds: number[], asOfDate: string) {
  if (listingIds.length === 0) {
    return [];
  }
  const result = await query<PriceRow>(
    `select listing_id, date, close
     from (
       select listing_id, date, close,
         row_number() over (partition by listing_id order by date desc) as rn
       from prices_eod
       where listing_id = any($1) and date <= $2
     ) t
     where rn <= 2
     order by listing_id, date desc`,
    [listingIds, asOfDate]
  );
  return result.rows;
}

function buildPriceMap(rows: PriceRow[]) {
  const map = new Map<number, { latest?: PriceRow; previous?: PriceRow }>();
  for (const row of rows) {
    const entry = map.get(row.listing_id) ?? {};
    if (!entry.latest) {
      entry.latest = row;
    } else if (!entry.previous) {
      entry.previous = row;
    }
    map.set(row.listing_id, entry);
  }
  return map;
}

async function loadFxRates(
  pairs: Array<{ base: string; quote: string }>,
  from: string,
  to: string
) {
  if (pairs.length === 0) {
    return [];
  }
  const clauses: string[] = [];
  const params: Array<string> = [];
  let index = 1;
  for (const pair of pairs) {
    clauses.push(`(base_currency = $${index} and quote_currency = $${index + 1})`);
    params.push(pair.base, pair.quote);
    index += 2;
  }
  params.push(from, to);
  const result = await query<FxRateRow>(
    `select base_currency, quote_currency, date, rate
     from fx_rates_eod
     where (${clauses.join(" or ")}) and date >= $${index} and date <= $${index + 1}
     order by base_currency, quote_currency, date asc`,
    params
  );
  return result.rows;
}

function buildFxLookup(
  baseCurrency: string,
  fxRows: FxRateRow[]
): (currency: string, date: string) => { rate: number; estimated: boolean; stale: boolean } | null {
  const map = new Map<string, FxRateRow[]>();
  for (const row of fxRows) {
    const key = `${row.base_currency}::${row.quote_currency}`;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }

  return (currency: string, date: string) => {
    if (currency === baseCurrency) {
      return { rate: 1, estimated: false, stale: false };
    }
    const key = `${currency}::${baseCurrency}`;
    const rates = map.get(key) ?? [];
    const target = toDate(date);
    let selected: FxRateRow | null = null;
    for (const rate of rates) {
      const rateDate = toDate(rate.date);
      if (rateDate <= target) {
        selected = rate;
      } else {
        break;
      }
    }
    if (!selected) {
      return null;
    }
    const ageDays = Math.floor((target.getTime() - toDate(selected.date).getTime()) / (24 * 60 * 60 * 1000));
    return {
      rate: Number(selected.rate),
      estimated: ageDays > 0,
      stale: ageDays > 7,
    };
  };
}

export async function getPositionsData(orgId: number, portfolioId: number, date: string) {
  const portfolio = await loadPortfolio(orgId, portfolioId);
  if (!portfolio) {
    throw new Error("PORTFOLIO_NOT_FOUND");
  }

  const transactions = await loadTransactions(orgId, portfolioId, date);
  const currencies = Array.from(new Set(transactions.map((tx) => tx.currency)));
  const fxPairs = currencies
    .filter((currency) => currency !== portfolio.base_currency)
    .map((currency) => ({ base: currency, quote: portfolio.base_currency }));
  const fxRows = await loadFxRates(
    fxPairs,
    formatDate(new Date(toDate(date).getTime() - 7 * 24 * 60 * 60 * 1000)),
    date
  );
  const fxLookup = buildFxLookup(portfolio.base_currency, fxRows);

  const { holdings, warnings, estimated } = await buildHoldings(
    transactions,
    async (currency, rateDate) => fxLookup(currency, rateDate),
    portfolio.base_currency
  );

  const listingIds = Array.from(holdings.keys());
  const listingInfo = await loadListingInfo(listingIds);
  const listingMap = new Map(listingInfo.map((info) => [info.id, info]));
  let priceRows = await loadLatestPrices(listingIds, date);
  let asOfDate = date;

  if (priceRows.length === 0 && listingIds.length > 0) {
    const latest = await query<{ date: string | null }>(
      "select max(date) as date from prices_eod where listing_id = any($1)",
      [listingIds]
    );
    const latestDate = latest.rows[0]?.date ?? null;
    if (latestDate) {
      asOfDate = latestDate;
      priceRows = await loadLatestPrices(listingIds, latestDate);
      warnings.push(`Using latest available price date ${latestDate} for positions.`);
    }
  }

  const priceMap = buildPriceMap(priceRows);

  const positions = listingIds.map((listingId) => {
    const holding = holdings.get(listingId)!;
    const info = listingMap.get(listingId);
    const priceEntry = priceMap.get(listingId);
    const latest = priceEntry?.latest ?? null;
    const previous = priceEntry?.previous ?? null;

    const priceClose = latest ? Number(latest.close) : null;
    const priceDate = latest?.date ?? null;
    const priceEstimated = latest ? latest.date !== asOfDate : true;

    if (!latest) {
      warnings.push(`Missing price for listing ${listingId} on ${date}`);
    }

    let fxRate = 1;
    let fxEstimated = false;
    if (info && info.currency !== portfolio.base_currency) {
      const fxDate = priceDate ? normalizeDateKey(priceDate) : date;
      const fx = fxLookup(info.currency, previousDateKey(fxDate));
      if (!fx) {
        warnings.push(
          `Missing FX rate for ${info.currency}/${portfolio.base_currency} on ${previousDateKey(fxDate)}`
        );
        fxEstimated = true;
      } else {
        fxRate = fx.rate;
        fxEstimated = fx.estimated;
        if (fx.stale) {
          warnings.push(
            `FX rate for ${info.currency}/${portfolio.base_currency} is older than 7 days at ${previousDateKey(
              fxDate
            )}`
          );
        }
      }
    }

    const marketValueBase = computeMarketValue(holding.quantity, priceClose, fxRate);
    const costBasisBase = computeCostBasis(holding.quantity, holding.avgCostBase);
    const totalPnlBase = computeTotalPnL(marketValueBase, costBasisBase);

    const dayChangeBase = computeDayChange(
      latest ? Number(latest.close) : null,
      previous ? Number(previous.close) : null,
      holding.quantity,
      fxRate
    );

    const estimatedValue = priceEstimated || fxEstimated;

    return {
      listing_id: listingId,
      ticker: info?.ticker ?? null,
      instrument_id: info?.instrument_id ?? null,
      instrument_name: info?.instrument_name ?? null,
      sector: info?.sector ?? null,
      currency: info?.currency ?? null,
      quantity: holding.quantity,
      avg_cost_base: holding.avgCostBase,
      cost_basis_base: costBasisBase,
      price_close: priceClose,
      price_date: priceDate,
      market_value_base: marketValueBase,
      day_change_base: dayChangeBase,
      total_pnl_base: totalPnlBase,
      estimated: estimatedValue,
    };
  });

  return {
    portfolio,
    positions,
    estimated: estimated || positions.some((pos) => pos.estimated),
    warnings,
    asOfDate,
  };
}

router.get("/portfolios/:portfolioId/positions", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const parsed = dateSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Missing date parameter");
    }

    const positionsData = await getPositionsData(orgId, portfolioId, parsed.data.date);

    return sendData(res, positionsData.positions, {
      estimated: positionsData.estimated,
      warnings: positionsData.warnings,
      as_of_date: positionsData.asOfDate,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "PORTFOLIO_NOT_FOUND") {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }
    return next(err);
  }
});

router.get("/portfolios/:portfolioId/allocation", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const parsed = dateSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Missing date parameter");
    }

    const positionsResponse = await getPositionsData(orgId, portfolioId, parsed.data.date);

    const totalValue = positionsResponse.positions.reduce(
      (sum, pos) => sum + (pos.market_value_base ?? 0),
      0
    );

    const byInstrument = new Map<number, { name: string | null; value: number }>();
    const bySector = new Map<string, number>();
    const byCurrency = new Map<string, number>();

    for (const pos of positionsResponse.positions) {
      if (pos.market_value_base === null) {
        continue;
      }
      if (pos.instrument_id) {
        const entry = byInstrument.get(pos.instrument_id) ?? {
          name: pos.instrument_name ?? null,
          value: 0,
        };
        entry.value += pos.market_value_base;
        byInstrument.set(pos.instrument_id, entry);
      }

      if (pos.sector) {
        bySector.set(pos.sector, (bySector.get(pos.sector) ?? 0) + pos.market_value_base);
      }

      if (pos.currency) {
        byCurrency.set(pos.currency, (byCurrency.get(pos.currency) ?? 0) + pos.market_value_base);
      }
    }

    const allocation = {
      by_instrument: Array.from(byInstrument.entries()).map(([instrumentId, entry]) => ({
        instrument_id: instrumentId,
        name: entry.name,
        value_base: entry.value,
        weight: totalValue > 0 ? entry.value / totalValue : 0,
      })),
      by_sector: Array.from(bySector.entries()).map(([sector, value]) => ({
        sector,
        value_base: value,
        weight: totalValue > 0 ? value / totalValue : 0,
      })),
      by_currency: Array.from(byCurrency.entries()).map(([currency, value]) => ({
        currency,
        value_base: value,
        weight: totalValue > 0 ? value / totalValue : 0,
      })),
      total_value_base: totalValue,
    };

    return sendData(res, allocation, {
      estimated: positionsResponse.estimated,
      warnings: positionsResponse.warnings,
      as_of_date: positionsResponse.asOfDate,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "PORTFOLIO_NOT_FOUND") {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }
    return next(err);
  }
});

router.get("/portfolios/:portfolioId/performance", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const parsed = rangeSchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(res, 400, "VALIDATION_ERROR", "Missing from/to parameters");
    }

    const portfolio = await loadPortfolio(orgId, portfolioId);
    if (!portfolio) {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }

    const transactions = await loadTransactions(orgId, portfolioId, parsed.data.to);
    const listingIds = Array.from(new Set(transactions.map((tx) => tx.listing_id)));

    if (listingIds.length === 0) {
      return sendData(res, []);
    }

    const listingInfo = await loadListingInfo(listingIds);
    const listingMap = new Map(listingInfo.map((info) => [info.id, info]));

    let rangeFrom = parsed.data.from;
    let rangeTo = parsed.data.to;

    let priceRows = await query<PriceRow>(
      "select listing_id, date, close from prices_eod where listing_id = any($1) and date between $2 and $3 order by listing_id, date asc",
      [listingIds, rangeFrom, rangeTo]
    );


    const priceSeed = await query<PriceRow>(
      `select listing_id, date, close
       from (
         select listing_id, date, close,
           row_number() over (partition by listing_id order by date desc) as rn
         from prices_eod
         where listing_id = any($1) and date < $2
       ) t
       where rn = 1`,
      [listingIds, rangeFrom]
    );

    const priceMap = new Map<number, Map<string, number>>();
    const earliestByListing = new Map<number, { date: string; close: number }>();
    for (const row of priceRows.rows) {
      const entry = priceMap.get(row.listing_id) ?? new Map<string, number>();
      const dateKey = normalizeDateKey(row.date);
      if (!earliestByListing.has(row.listing_id)) {
        earliestByListing.set(row.listing_id, { date: dateKey, close: Number(row.close) });
      }
      entry.set(dateKey, Number(row.close));
      priceMap.set(row.listing_id, entry);
    }

    const globalEarliestPrice = Array.from(earliestByListing.values())
      .map((row) => row.date)
      .sort()[0] ?? null;

    const priceLast = new Map<number, { date: string; close: number }>();
    for (const row of priceSeed.rows) {
      const dateKey = normalizeDateKey(row.date);
      priceLast.set(row.listing_id, { date: dateKey, close: Number(row.close) });
    }
    for (const listingId of listingIds) {
      if (!priceLast.has(listingId)) {
        const earliest = earliestByListing.get(listingId);
        if (earliest) {
          priceLast.set(listingId, earliest);
        }
      }
    }

    const currencies = Array.from(
      new Set(listingInfo.map((info) => info.currency).filter((c) => c !== portfolio.base_currency))
    );
    const fxPairs = currencies.map((currency) => ({ base: currency, quote: portfolio.base_currency }));
    const fxRows = await loadFxRates(
      fxPairs,
      formatDate(new Date(toDate(rangeFrom).getTime() - 7 * 24 * 60 * 60 * 1000)),
      rangeTo
    );
    const fxLookup = buildFxLookup(portfolio.base_currency, fxRows);

    const txByDate = new Map<string, TransactionRow[]>();
    const seedTransactions: TransactionRow[] = [];
    for (const tx of transactions) {
      const tradeDate = normalizeDateKey(tx.trade_date);
      if (tradeDate < rangeFrom) {
        seedTransactions.push(tx);
        continue;
      }
      if (tradeDate > rangeTo) {
        continue;
      }
      const list = txByDate.get(tradeDate) ?? [];
      list.push(tx);
      txByDate.set(tradeDate, list);
    }

    const holdings = new Map<number, { quantity: number; avgCostBase: number }>();
    for (const tx of seedTransactions) {
      const holding = holdings.get(tx.listing_id) ?? { quantity: 0, avgCostBase: 0 };
      const info = listingMap.get(tx.listing_id);
      let rate = 1;
      if (info && info.currency !== portfolio.base_currency) {
        const fx = fxLookup(info.currency, normalizeDateKey(tx.trade_date));
        if (fx) {
          rate = fx.rate;
        }
        // If fx is null, use rate=1 (already set above)
      }
      const normalized = normalizeTransaction(tx);
      if (!normalized) {
        continue;
      }
      applyTransaction(holding, normalized, rate);
      if (holding.quantity > 0) {
        holdings.set(tx.listing_id, holding);
      } else {
        holdings.delete(tx.listing_id);
      }
    }

    const series: Array<{ date: string; total_value_base: number; estimated: boolean }> = [];

    const dates = listDates(rangeFrom, rangeTo);
    let started = false;
    for (const date of dates) {
      const dailyTx = txByDate.get(date) ?? [];
      for (const tx of dailyTx) {
        const holding = holdings.get(tx.listing_id) ?? { quantity: 0, avgCostBase: 0 };
        const info = listingMap.get(tx.listing_id);
        
        // Handle FX lookup - use rate=1 if missing
        let fxRate = 1;
        if (info && info.currency !== portfolio.base_currency) {
          const fx = fxLookup(info.currency, date);
          if (fx) {
            fxRate = fx.rate;
          }
          // If fx is null, use rate=1 (already set above)
        }
        
        const normalized = normalizeTransaction(tx);
        if (!normalized) {
          continue;
        }
        applyTransaction(holding, normalized, fxRate);
        if (holding.quantity > 0) {
          holdings.set(tx.listing_id, holding);
        } else {
          holdings.delete(tx.listing_id);
        }
      }

      let totalValue = 0;
      let estimated = false;

      const hasHoldings = holdings.size > 0;
      if (!started && !hasHoldings) {
        continue;
      }
      if (hasHoldings && globalEarliestPrice && date < globalEarliestPrice) {
        continue;
      }
      if (hasHoldings) {
        started = true;
      }

      for (const [listingId, holding] of holdings.entries()) {
        const priceEntry = priceMap.get(listingId);
        const priceForDay = priceEntry?.get(date) ?? null;
        if (priceForDay !== null) {
          priceLast.set(listingId, { date, close: priceForDay });
        }
        const lastPrice = priceLast.get(listingId);
        if (!lastPrice) {
          estimated = true;
          continue;
        }
        if (lastPrice.date !== date) {
          estimated = true;
        }
        const info = listingMap.get(listingId);
        
        // Handle FX lookup - use rate=1 if missing (same as positions endpoint)
        let fxRate = 1;
        if (info && info.currency !== portfolio.base_currency) {
          const fx = fxLookup(info.currency, previousDateKey(date));
          if (!fx) {
            // Missing FX rate - use 1 and mark as estimated
            estimated = true;
          } else {
            fxRate = fx.rate;
            if (fx.estimated) {
              estimated = true;
            }
          }
        }
        
        totalValue += lastPrice.close * holding.quantity * fxRate;
      }

      series.push({ date, total_value_base: totalValue, estimated });
    }

    return sendData(res, series, {
      estimated: series.some((entry) => entry.estimated),
      as_of_date: rangeTo,
      from: rangeFrom,
      to: rangeTo,
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/portfolios/:portfolioId/summary", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const today = formatDate(new Date());
    const positionsData = await getPositionsData(orgId, portfolioId, today);

    const totalMarketValueBase = positionsData.positions.reduce(
      (sum, pos) => sum + (pos.market_value_base ?? 0),
      0
    );
    const pnlDayBase = positionsData.positions.reduce(
      (sum, pos) => sum + (pos.day_change_base ?? 0),
      0
    );
    const previousTotal = totalMarketValueBase - pnlDayBase;
    const pnlDayPercent = previousTotal !== 0 ? pnlDayBase / previousTotal : 0;

    const countPositionsUp = positionsData.positions.filter((pos) => (pos.day_change_base ?? 0) > 0).length;
    const countPositionsDown = positionsData.positions.filter((pos) => (pos.day_change_base ?? 0) < 0).length;

    const lastPriceDate = positionsData.positions.length > 0 ? positionsData.asOfDate : null;

    let countNewBuySignals = 0;
    if (lastPriceDate) {
      const signalCount = await query<{ count: string }>(
        `select count(distinct signals.id) as count
         from signals
         join strategy_targets on strategy_targets.strategy_id = signals.strategy_id
          and strategy_targets.org_id = signals.org_id
         where signals.org_id = $1
          and signals.signal_type = 'BUY'
          and signals.date = $2
          and strategy_targets.active = true
          and strategy_targets.portfolio_id = $3
          and (strategy_targets.listing_id is null or strategy_targets.listing_id = signals.listing_id)`,
        [orgId, lastPriceDate, portfolioId]
      );
      countNewBuySignals = Number(signalCount.rows[0]?.count ?? 0);
    }

    return sendData(res, {
      total_market_value_base: totalMarketValueBase,
      pnl_day_base: {
        absolute: pnlDayBase,
        percent: pnlDayPercent,
      },
      count_new_buy_signals_today: countNewBuySignals,
      count_positions_up_today: countPositionsUp,
      count_positions_down_today: countPositionsDown,
      last_price_date: lastPriceDate,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "PORTFOLIO_NOT_FOUND") {
      return sendError(res, 404, "NOT_FOUND", "Portfolio not found");
    }
    return next(err);
  }
});

export { router as performanceRouter };
