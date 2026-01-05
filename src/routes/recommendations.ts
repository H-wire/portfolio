import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";
import { createRecommendations } from "../services/recommendations";

const router = Router({ mergeParams: true });

const runSchema = z.object({
  riskLevel: z.number().int().min(1).max(10),
  topN: z.number().int().min(1).max(10),
});

async function ensurePortfolio(orgId: number, portfolioId: number) {
  const result = await query<{ id: number }>(
    "select id from portfolios where id = $1 and org_id = $2",
    [portfolioId, orgId]
  );
  return result.rows[0] ?? null;
}

router.get("/portfolios/:portfolioId/recommendations/latest", async (req, res, next) => {
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

    const result = await query<{
      id: number;
      as_of_month: string;
      risk_level: number;
      top_n: number;
      items: Record<string, unknown>;
      created_at: Date;
    }>(
      `select id, as_of_month, risk_level, top_n, items, created_at
       from recommendations
       where org_id = $1 and portfolio_id = $2
       order by created_at desc
       limit 1`,
      [orgId, portfolioId]
    );

    return sendData(res, result.rows[0] ?? null);
  } catch (err) {
    return next(err);
  }
});

router.get("/portfolios/:portfolioId/factor-scores", async (req, res, next) => {
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

    const dateParam = typeof req.query.date === "string" ? req.query.date : null;
    let asOfDate = dateParam;
    if (!asOfDate) {
      const latest = await query<{ as_of_date: string }>(
        "select as_of_date from factor_scores where org_id = $1 and portfolio_id = $2 order by as_of_date desc limit 1",
        [orgId, portfolioId]
      );
      asOfDate = latest.rows[0]?.as_of_date ?? null;
    }

    if (!asOfDate) {
      return sendData(res, []);
    }

    const result = await query<{
      listing_id: number;
      instrument_id: number;
      as_of_date: string;
      quality_score: string | null;
      trend_score: string | null;
      rs_score: string | null;
      timing_score: string | null;
      vol_score: string | null;
      total_score: string | null;
      passed_quality_filter: boolean;
      passed_trend_filter: boolean;
      payload: Record<string, unknown>;
      ticker: string;
      instrument_name: string | null;
    }>(
      `select factor_scores.listing_id,
              factor_scores.instrument_id,
              factor_scores.as_of_date,
              factor_scores.quality_score,
              factor_scores.trend_score,
              factor_scores.rs_score,
              factor_scores.timing_score,
              factor_scores.vol_score,
              factor_scores.total_score,
              factor_scores.passed_quality_filter,
              factor_scores.passed_trend_filter,
              factor_scores.payload,
              listings.ticker,
              instruments.name as instrument_name
       from factor_scores
       join listings on listings.id = factor_scores.listing_id
       join instruments on instruments.id = listings.instrument_id
       where factor_scores.org_id = $1 and factor_scores.portfolio_id = $2 and factor_scores.as_of_date = $3
       order by factor_scores.total_score desc nulls last`,
      [orgId, portfolioId, asOfDate]
    );

    return sendData(res, result.rows, { as_of_date: asOfDate });
  } catch (err) {
    return next(err);
  }
});

router.post("/portfolios/:portfolioId/recommendations/run", async (req, res, next) => {
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

    const payload = runSchema.parse(req.body);
    const result = await createRecommendations(orgId, portfolioId, payload.riskLevel, payload.topN);

    return sendData(res, {
      as_of_month: result.asOfMonth,
      items: result.items,
      risk_level: payload.riskLevel,
      top_n: payload.topN,
    });
  } catch (err) {
    return next(err);
  }
});

export { router as recommendationsRouter };
