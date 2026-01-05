import { query } from "../db";
import {
  buildReason,
  computeRawMetrics,
  computeTimingScore,
  passesQualityFilter,
  passesTrendFilter,
  percentileRank,
  weightsForRiskLevel,
  type FactorPayload,
  type FactorScores,
  type FundamentalsInput,
} from "../domain/factors";
import type { PriceBar } from "../domain/indicators";
import { getLatestFundamentals } from "./fundamentals";

export type UniverseItem = {
  listing_id: number;
  instrument_id: number;
  ticker: string;
};

export type RecommendationItem = {
  listing_id: number;
  ticker: string;
  total_score: number | null;
  scores: {
    quality: number | null;
    trend: number | null;
    rs: number | null;
    timing: number | null;
    vol: number | null;
  };
  reason: string;
  eligible: boolean;
  recommended: boolean;
};

export async function loadUniverse(orgId: number, portfolioId: number) {
  const result = await query<UniverseItem>(
    `select distinct listings.id as listing_id,
            listings.instrument_id,
            listings.ticker
     from listings
     where listings.active = true
       and listings.id in (
         select distinct listing_id
         from transactions
         where org_id = $1 and portfolio_id = $2
         union
         select distinct wi.listing_id
         from watchlist_items wi
         join watchlists w on w.id = wi.watchlist_id
         where w.org_id = $1
       )`,
    [orgId, portfolioId]
  );
  return result.rows;
}

export async function loadPriceHistory(listingId: number, limit = 400): Promise<PriceBar[]> {
  const rows = await query<{ date: string; open: string; high: string; low: string; close: string }>(
    `select date, open, high, low, close from (
       select date, open, high, low, close
       from prices_eod
       where listing_id = $1
       order by date desc
       limit $2
     ) t
     order by date asc`,
    [listingId, limit]
  );

  return rows.rows.map((row) => ({
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : row.date,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
  }));
}

function toNumber(value: string | null) {
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fundamentalsInputFromRow(row: Awaited<ReturnType<typeof getLatestFundamentals>>): FundamentalsInput {
  return {
    epsTtm: row ? toNumber(row.eps_ttm) : null,
    operatingCashflowTtm: row ? toNumber(row.operating_cashflow_ttm) : null,
    ebitTtm: row ? toNumber(row.ebit_ttm) : null,
    taxRate: row ? toNumber(row.tax_rate) : null,
    totalDebt: row ? toNumber(row.total_debt) : null,
    totalEquity: row ? toNumber(row.total_equity) : null,
    cashAndEquivalents: row ? toNumber(row.cash_and_equivalents) : null,
  };
}

export type FactorScoreRow = {
  listing_id: number;
  instrument_id: number;
  ticker: string;
  as_of_date: string | null;
  scores: FactorScores;
  payload: FactorPayload;
};

export async function computeFactorScores(
  orgId: number,
  portfolioId: number,
  riskLevel: number
): Promise<FactorScoreRow[]> {
  const universe = await loadUniverse(orgId, portfolioId);
  if (universe.length === 0) {
    return [];
  }

  const metrics = await Promise.all(
    universe.map(async (item) => {
      const prices = await loadPriceHistory(item.listing_id);
      const latestDate = prices[prices.length - 1]?.date ?? null;
      const fundamentalsRow = await getLatestFundamentals(item.instrument_id);
      const fundamentals = fundamentalsInputFromRow(fundamentalsRow);
      const raw = computeRawMetrics(prices, fundamentals);
      const qualityPass = passesQualityFilter(fundamentals);
      const trendPass = passesTrendFilter(raw.price, raw.ma50, raw.ma200);

      return {
        item,
        prices,
        raw,
        fundamentals,
        latestDate,
        qualityPass,
        trendPass,
      };
    })
  );

  const roicRanks = percentileRank(metrics.map((row) => row.raw.roic));
  const trendRanks = percentileRank(metrics.map((row) => row.raw.trendRaw));
  const rsRanks = percentileRank(metrics.map((row) => row.raw.rs));
  const volRanks = percentileRank(metrics.map((row) => row.raw.volatility));

  const weights = weightsForRiskLevel(riskLevel);

  return metrics.map((row, index) => {
    const timingScore = computeTimingScore(row.raw.rsi14, riskLevel);
    const qualityScore = roicRanks[index];
    const trendScore = trendRanks[index];
    const rsScore = rsRanks[index];
    const volScore = volRanks[index] === null ? null : 100 - (volRanks[index] ?? 0);

    const totalScore =
      qualityScore === null || trendScore === null || rsScore === null || timingScore === null || volScore === null
        ? null
        : qualityScore * weights.w_quality +
          trendScore * weights.w_trend +
          rsScore * weights.w_momentum +
          timingScore * weights.w_timing +
          volScore * weights.w_vol;

    const scores: FactorScores = {
      qualityScore,
      trendScore,
      rsScore,
      timingScore,
      volScore,
      totalScore,
    };

    const payload: FactorPayload = {
      values: {
        roic: row.raw.roic,
        price: row.raw.price,
        ma50: row.raw.ma50,
        ma200: row.raw.ma200,
        rsi: row.raw.rsi14,
        atr: row.raw.atr20,
        volatility: row.raw.volatility,
        rs_6m: row.raw.rs6m,
        rs_12m: row.raw.rs12m,
      },
      scores: {
        quality: qualityScore,
        trend: trendScore,
        rs: rsScore,
        timing: timingScore,
        vol: volScore,
        total: totalScore,
      },
      passes: {
        qualityFilter: row.qualityPass,
        trendFilter: row.trendPass,
      },
      weights,
      reason: buildReason({ qualityFilter: row.qualityPass, trendFilter: row.trendPass }, scores),
    };

    return {
      listing_id: row.item.listing_id,
      instrument_id: row.item.instrument_id,
      ticker: row.item.ticker,
      as_of_date: row.latestDate,
      scores,
      payload,
    };
  });
}

export async function persistFactorScores(
  orgId: number,
  portfolioId: number,
  rows: FactorScoreRow[]
) {
  if (rows.length === 0) {
    return;
  }
  for (const row of rows) {
    if (!row.as_of_date) {
      continue;
    }
    await query(
      `insert into factor_scores
       (org_id, portfolio_id, listing_id, instrument_id, as_of_date, quality_score, trend_score, rs_score, timing_score, vol_score, total_score,
        passed_quality_filter, passed_trend_filter, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (org_id, portfolio_id, listing_id, as_of_date)
       do update set
         quality_score = excluded.quality_score,
         trend_score = excluded.trend_score,
         rs_score = excluded.rs_score,
         timing_score = excluded.timing_score,
         vol_score = excluded.vol_score,
         total_score = excluded.total_score,
         passed_quality_filter = excluded.passed_quality_filter,
         passed_trend_filter = excluded.passed_trend_filter,
         payload = excluded.payload`,
      [
        orgId,
        portfolioId,
        row.listing_id,
        row.instrument_id,
        row.as_of_date,
        row.scores.qualityScore,
        row.scores.trendScore,
        row.scores.rsScore,
        row.scores.timingScore,
        row.scores.volScore,
        row.scores.totalScore,
        row.payload.passes.qualityFilter,
        row.payload.passes.trendFilter,
        row.payload,
      ]
    );
  }
}

export async function createRecommendations(
  orgId: number,
  portfolioId: number,
  riskLevel: number,
  topN: number
) {
  const scores = await computeFactorScores(orgId, portfolioId, riskLevel);
  await persistFactorScores(orgId, portfolioId, scores);

  const rankedAll = scores
    .slice()
    .sort((a, b) => (b.scores.totalScore ?? -Infinity) - (a.scores.totalScore ?? -Infinity));

  const eligible = rankedAll.filter(
    (row) => row.payload.passes.qualityFilter && row.payload.passes.trendFilter && row.scores.totalScore !== null
  );
  const recommendedIds = new Set(eligible.slice(0, topN).map((row) => row.listing_id));

  const items: RecommendationItem[] = rankedAll.map((row) => ({
    listing_id: row.listing_id,
    ticker: row.ticker,
    total_score: row.scores.totalScore,
    scores: {
      quality: row.scores.qualityScore,
      trend: row.scores.trendScore,
      rs: row.scores.rsScore,
      timing: row.scores.timingScore,
      vol: row.scores.volScore,
    },
    reason: row.payload.reason,
    eligible: row.payload.passes.qualityFilter && row.payload.passes.trendFilter,
    recommended: recommendedIds.has(row.listing_id),
  }));

  const itemsJson = JSON.stringify(items);

  const asOfDate = eligible[0]?.as_of_date ?? rankedAll[0]?.as_of_date ?? scores[0]?.as_of_date ?? new Date().toISOString().slice(0, 10);
  const asOfMonth = asOfDate.slice(0, 7);

  const result = await query<{ id: number }>(
    `insert into recommendations (org_id, portfolio_id, as_of_month, risk_level, top_n, items)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (org_id, portfolio_id, as_of_month, risk_level)
     do update set
       top_n = excluded.top_n,
       items = excluded.items,
       created_at = now()
     returning id`,
    [orgId, portfolioId, asOfMonth, riskLevel, topN, itemsJson]
  );

  return {
    recommendationId: result.rows[0]?.id ?? null,
    asOfMonth,
    items,
    scores,
  };
}
