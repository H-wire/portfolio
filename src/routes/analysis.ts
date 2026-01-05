import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";
import { callLlm } from "../llm/client";
import { analysisExpiry, buildCacheKey, enforceRateLimits, findCachedAnalysis, storeAnalysis } from "../llm/cache";
import { loadPrompt, renderPrompt } from "../llm/prompts";
import { getPositionsData } from "./performance";

const router = Router({ mergeParams: true });

function llmEnabled() {
  return (process.env.LLM_ENABLED ?? "false").toLowerCase() === "true";
}

const recommendationExplainSchema = z.object({
  portfolioId: z.coerce.number().int().positive(),
  listingId: z.coerce.number().int().positive(),
  riskLevel: z.coerce.number().int().min(1).max(10).optional(),
  topN: z.coerce.number().int().min(1).max(10).optional(),
  asOfDate: z.string().optional(),
});

const regimeAnalysisSchema = z.object({
  index_ticker: z.string().min(1).max(20),
  vix_ticker: z.string().min(1).max(20),
  start_date: z.string().min(10).max(10),
  ma_short: z.coerce.number().int().min(2).max(300),
  ma_long: z.coerce.number().int().min(20).max(400),
  rsi_period: z.coerce.number().int().min(2).max(50),
  rsi_threshold: z.coerce.number().int().min(1).max(99),
  vix_threshold_bull: z.coerce.number().int().min(5).max(80),
  vix_threshold_bear: z.coerce.number().int().min(5).max(80),
  component_tickers: z.array(z.string().min(1).max(20)).optional(),
});

async function logEvent(orgId: number, type: string, payload: Record<string, unknown>) {
  await query(
    "insert into events (org_id, type, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5)",
    [orgId, type, "llm", null, payload]
  );
}

router.get("/analysis/:analysisId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const analysisId = Number(req.params.analysisId);
    if (!Number.isFinite(analysisId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid analysis id");
    }

    const result = await query<{
      id: number;
      analysis_type: string;
      response_text: string;
      metadata: Record<string, unknown>;
      created_at: Date;
    }>(
      "select id, analysis_type, response_text, metadata, created_at from llm_analyses where id = $1 and org_id = $2",
      [analysisId, orgId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Analysis not found");
    }

    return sendData(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.post("/analysis/signal/:signalId", async (req, res, next) => {
  try {
    if (!llmEnabled()) {
      return sendError(res, 400, "LLM_DISABLED", "LLM is disabled");
    }
    const orgId = req.orgId ?? 0;
    const userId = req.user?.id ?? 0;
    const signalId = Number(req.params.signalId);
    if (!Number.isFinite(signalId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid signal id");
    }

    const limits = await enforceRateLimits(orgId, userId);
    if (!limits.allowed) {
      return sendError(res, 429, "RATE_LIMITED", limits.message ?? "Rate limit exceeded");
    }

    const signalResult = await query<{
      id: number;
      signal_type: string;
      date: string;
      strategy_id: number;
      listing_id: number;
      payload: Record<string, unknown>;
    }>(
      "select id, signal_type, date, strategy_id, listing_id, payload from signals where id = $1 and org_id = $2",
      [signalId, orgId]
    );

    if (signalResult.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Signal not found");
    }

    const listingResult = await query<{
      ticker: string;
      instrument_name: string;
    }>(
      "select listings.ticker, instruments.name as instrument_name from listings join instruments on instruments.id = listings.instrument_id where listings.id = $1",
      [signalResult.rows[0].listing_id]
    );

    const priceRows = await query<{ date: string; close: string }>(
      "select date, close from prices_eod where listing_id = $1 order by date desc limit 10",
      [signalResult.rows[0].listing_id]
    );

    const priceSummary = priceRows.rows
      .map((row) => `${row.date}: ${Number(row.close).toFixed(2)}`)
      .join("\n");

    const indicatorValues = JSON.stringify(signalResult.rows[0].payload?.values ?? {}, null, 2);

    const inputData = {
      signal_id: signalId,
      signal_type: signalResult.rows[0].signal_type,
      date: signalResult.rows[0].date,
      instrument_name: listingResult.rows[0]?.instrument_name ?? "Unknown",
      ticker: listingResult.rows[0]?.ticker ?? "",
      indicator_values: indicatorValues,
      price_history_summary: priceSummary,
      triggered_rule: signalResult.rows[0].payload?.triggered_rule_id ?? "unknown",
    };

    const cacheKey = buildCacheKey(inputData);
    const cached = await findCachedAnalysis(orgId, "SIGNAL_EXPLANATION", signalId, cacheKey);
    if (cached) {
      return sendData(res, cached);
    }

    const template = loadPrompt("signal_explanation.txt");
    const prompt = renderPrompt(template, {
      signal_type: String(inputData.signal_type),
      instrument_name: String(inputData.instrument_name),
      ticker: String(inputData.ticker),
      date: String(inputData.date),
      indicator_values: String(inputData.indicator_values),
      price_history_summary: String(inputData.price_history_summary),
      triggered_rule: String(inputData.triggered_rule),
    });

    const start = Date.now();
    const llmResponse = await callLlm(prompt, inputData);
    const duration = Date.now() - start;
    const expiresAt = new Date(Date.now() + analysisExpiry("SIGNAL_EXPLANATION"));

    const analysisId = await storeAnalysis({
      orgId,
      entityType: "signal",
      entityId: signalId,
      analysisType: "SIGNAL_EXPLANATION",
      promptTemplate: "prompts/signal_explanation.txt",
      model: llmResponse.model,
      inputData,
      responseText: llmResponse.text,
      metadata: {
        cache_key: cacheKey,
        user_id: String(userId),
        duration_ms: duration,
        tokens_used: llmResponse.usage?.total_tokens ?? null,
      },
      expiresAt,
    });

    await logEvent(orgId, "LLM_ANALYSIS", {
      source: "api",
      status: "ok",
      analysis_type: "SIGNAL_EXPLANATION",
      analysis_id: analysisId,
    });

    return sendData(res, { id: analysisId, response_text: llmResponse.text });
  } catch (err) {
    return next(err);
  }
});

router.post("/analysis/portfolio/:portfolioId", async (req, res, next) => {
  try {
    if (!llmEnabled()) {
      return sendError(res, 400, "LLM_DISABLED", "LLM is disabled");
    }
    const orgId = req.orgId ?? 0;
    const userId = req.user?.id ?? 0;
    const portfolioId = Number(req.params.portfolioId);
    if (!Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const limits = await enforceRateLimits(orgId, userId);
    if (!limits.allowed) {
      return sendError(res, 429, "RATE_LIMITED", limits.message ?? "Rate limit exceeded");
    }

    const positionsData = await getPositionsData(orgId, portfolioId, new Date().toISOString().slice(0, 10));
    const totalValue = positionsData.positions.reduce(
      (sum, pos) => sum + (pos.market_value_base ?? 0),
      0
    );
    const allocation = positionsData.positions
      .filter((pos) => pos.market_value_base !== null)
      .map((pos) => `${pos.ticker ?? "—"}: ${pos.market_value_base}`)
      .slice(0, 10)
      .join("\n");

    const topHoldings = positionsData.positions
      .filter((pos) => pos.market_value_base !== null)
      .sort((a, b) => (b.market_value_base ?? 0) - (a.market_value_base ?? 0))
      .slice(0, 5)
      .map((pos) => `${pos.ticker ?? "—"} (${pos.market_value_base})`)
      .join(", ");

    const instrumentRows = await query<{ instrument_id: number }>(
      "select distinct listings.instrument_id from transactions join listings on listings.id = transactions.listing_id where transactions.org_id = $1 and transactions.portfolio_id = $2",
      [orgId, portfolioId]
    );
    const instrumentIds = instrumentRows.rows.map((row) => row.instrument_id);

    let recentNews = "None";
    if (instrumentIds.length > 0) {
      try {
        const newsRows = await query<{
          title: string;
          source: string;
          published_at: string;
          match_bases: string[];
        }>(
          `select news_items.title,
                  news_items.source,
                  news_items.published_at,
                  coalesce(array_remove(array_agg(distinct news_matches.match_basis), null), '{}') as match_bases
           from news_items
           join news_matches on news_matches.news_id = news_items.id
           where news_matches.instrument_id = any($1)
           group by news_items.id
           order by news_items.published_at desc
           limit 5`,
          [instrumentIds]
        );
        if (newsRows.rows.length > 0) {
          recentNews = newsRows.rows
            .map((row) => {
              const date = row.published_at instanceof Date
              ? row.published_at.toISOString().slice(0, 10)
              : String(row.published_at).slice(0, 10);
              const basis = row.match_bases.length > 0 ? row.match_bases.join("/") : "unmatched";
              return `${date} · ${row.source} · ${row.title} (${basis})`;
            })
            .join("\n");
        }
      } catch (err) {
        console.warn("Portfolio analysis news context failed", err);
      }
    }

    const inputData = {
      portfolio_id: portfolioId,
      total_value: totalValue.toFixed(2),
      currency: "BASE",
      num_holdings: positionsData.positions.length,
      allocation_breakdown: allocation || "No allocation data",
      day_change: "0",
      month_change: "0",
      ytd_change: "0",
      top_holdings: topHoldings || "None",
      recent_news: recentNews,
    };

    const cacheKey = buildCacheKey(inputData);
    const cached = await findCachedAnalysis(orgId, "PORTFOLIO_ANALYSIS", portfolioId, cacheKey);
    if (cached) {
      return sendData(res, cached);
    }

    const template = loadPrompt("portfolio_analysis.txt");
    const prompt = renderPrompt(template, {
      total_value: String(inputData.total_value),
      currency: String(inputData.currency),
      num_holdings: String(inputData.num_holdings),
      allocation_breakdown: String(inputData.allocation_breakdown),
      day_change: String(inputData.day_change),
      month_change: String(inputData.month_change),
      ytd_change: String(inputData.ytd_change),
      top_holdings: String(inputData.top_holdings),
      recent_news: String(inputData.recent_news),
    });

    const start = Date.now();
    const llmResponse = await callLlm(prompt, inputData);
    const duration = Date.now() - start;
    const expiresAt = new Date(Date.now() + analysisExpiry("PORTFOLIO_ANALYSIS"));

    const analysisId = await storeAnalysis({
      orgId,
      entityType: "portfolio",
      entityId: portfolioId,
      analysisType: "PORTFOLIO_ANALYSIS",
      promptTemplate: "prompts/portfolio_analysis.txt",
      model: llmResponse.model,
      inputData,
      responseText: llmResponse.text,
      metadata: {
        cache_key: cacheKey,
        user_id: String(userId),
        duration_ms: duration,
        tokens_used: llmResponse.usage?.total_tokens ?? null,
      },
      expiresAt,
    });

    await logEvent(orgId, "LLM_ANALYSIS", {
      source: "api",
      status: "ok",
      analysis_type: "PORTFOLIO_ANALYSIS",
      analysis_id: analysisId,
    });

    return sendData(res, { id: analysisId, response_text: llmResponse.text });
  } catch (err) {
    return next(err);
  }
});

router.post("/analysis/regime", async (req, res, next) => {
  try {
    const payload = regimeAnalysisSchema.parse(req.body);
    const yfinanceUrl = process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8001";
    const response = await fetch(`${yfinanceUrl}/regime-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      const message = text || "Regime analysis failed";
      if (response.status === 400) {
        return sendError(res, 400, "VALIDATION_ERROR", message);
      }
      return sendError(res, 502, "MARKET_DATA_ERROR", message);
    }
    const data = await response.json();
    return sendData(res, data);
  } catch (err) {
    return next(err);
  }
});

router.post("/analysis/recommendation", async (req, res, next) => {
  try {
    if (!llmEnabled()) {
      return sendError(res, 400, "LLM_DISABLED", "LLM is disabled");
    }
    const orgId = req.orgId ?? 0;
    const userId = req.user?.id ?? 0;
    const payload = recommendationExplainSchema.parse(req.body);

    const limits = await enforceRateLimits(orgId, userId);
    if (!limits.allowed) {
      return sendError(res, 429, "RATE_LIMITED", limits.message ?? "Rate limit exceeded");
    }

    let asOfDate = payload.asOfDate ?? null;
    if (!asOfDate) {
      const latest = await query<{ as_of_date: string }>(
        "select as_of_date from factor_scores where org_id = $1 and portfolio_id = $2 and listing_id = $3 order by as_of_date desc limit 1",
        [orgId, payload.portfolioId, payload.listingId]
      );
      asOfDate = latest.rows[0]?.as_of_date ?? null;
    }

    if (!asOfDate) {
      return sendError(res, 404, "NOT_FOUND", "No factor scores available");
    }

    const scoreResult = await query<{
      as_of_date: string;
      total_score: string | null;
      payload: Record<string, unknown> | null;
      ticker: string;
      instrument_name: string | null;
    }>(
      `select factor_scores.as_of_date,
              factor_scores.total_score,
              factor_scores.payload,
              listings.ticker,
              instruments.name as instrument_name
       from factor_scores
       join listings on listings.id = factor_scores.listing_id
       join instruments on instruments.id = listings.instrument_id
       where factor_scores.org_id = $1
         and factor_scores.portfolio_id = $2
         and factor_scores.listing_id = $3
         and factor_scores.as_of_date = $4
       limit 1`,
      [orgId, payload.portfolioId, payload.listingId, asOfDate]
    );

    if (scoreResult.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Factor score not found");
    }

    const row = scoreResult.rows[0];
    const scorePayload = (row.payload ?? {}) as Record<string, unknown>;
    const payloadScores = (scorePayload as { scores?: Record<string, unknown> }).scores ?? {};
    const payloadPasses = (scorePayload as { passes?: Record<string, unknown> }).passes ?? {};
    const payloadWeights = (scorePayload as { weights?: Record<string, unknown> }).weights ?? {};
    const payloadValues = (scorePayload as { values?: Record<string, unknown> }).values ?? {};
    const payloadReason = (scorePayload as { reason?: string }).reason ?? "";

    const inputData = {
      portfolio_id: payload.portfolioId,
      listing_id: payload.listingId,
      as_of_date: row.as_of_date,
      instrument_name: row.instrument_name ?? "Unknown",
      ticker: row.ticker,
      total_score: row.total_score ?? (payloadScores as { total?: number | null }).total ?? null,
      passes: payloadPasses,
      scores: payloadScores,
      weights: payloadWeights,
      values: payloadValues,
      reason: payloadReason,
      risk_level: payload.riskLevel ?? null,
      top_n: payload.topN ?? null,
    };

    const cacheKey = buildCacheKey(inputData);
    const cached = await findCachedAnalysis(orgId, "RECOMMENDATION_EXPLANATION", payload.listingId, cacheKey);
    if (cached) {
      return sendData(res, cached);
    }

    const template = loadPrompt("recommendation_explanation.txt");
    const prompt = renderPrompt(template, {
      instrument_name: String(inputData.instrument_name),
      ticker: String(inputData.ticker),
      as_of_date: String(inputData.as_of_date),
      total_score: String(inputData.total_score ?? "—"),
      passes: JSON.stringify(inputData.passes, null, 2),
      scores: JSON.stringify(inputData.scores, null, 2),
      weights: JSON.stringify(inputData.weights, null, 2),
      values: JSON.stringify(inputData.values, null, 2),
      reason: String(inputData.reason),
      risk_level: String(inputData.risk_level ?? "—"),
      top_n: String(inputData.top_n ?? "—"),
    });

    const start = Date.now();
    const llmResponse = await callLlm(prompt, inputData);
    const duration = Date.now() - start;
    const expiresAt = new Date(Date.now() + analysisExpiry("RECOMMENDATION_EXPLANATION"));

    const analysisId = await storeAnalysis({
      orgId,
      entityType: "listing",
      entityId: payload.listingId,
      analysisType: "RECOMMENDATION_EXPLANATION",
      promptTemplate: "prompts/recommendation_explanation.txt",
      model: llmResponse.model,
      inputData,
      responseText: llmResponse.text,
      metadata: {
        cache_key: cacheKey,
        user_id: String(userId),
        duration_ms: duration,
        tokens_used: llmResponse.usage?.total_tokens ?? null,
      },
      expiresAt,
    });

    await logEvent(orgId, "LLM_ANALYSIS", {
      source: "api",
      status: "ok",
      analysis_type: "RECOMMENDATION_EXPLANATION",
      analysis_id: analysisId,
    });

    return sendData(res, { id: analysisId, response_text: llmResponse.text });
  } catch (err) {
    return next(err);
  }
});

router.post("/analysis/news/:newsId", async (req, res, next) => {
  try {
    if (!llmEnabled()) {
      return sendError(res, 400, "LLM_DISABLED", "LLM is disabled");
    }
    const orgId = req.orgId ?? 0;
    const userId = req.user?.id ?? 0;
    const newsId = Number(req.params.newsId);
    if (!Number.isFinite(newsId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid news id");
    }

    const limits = await enforceRateLimits(orgId, userId);
    if (!limits.allowed) {
      return sendError(res, 429, "RATE_LIMITED", limits.message ?? "Rate limit exceeded");
    }

    const newsResult = await query<{
      id: number;
      source: string;
      title: string;
      summary: string | null;
      published_at: string;
    }>(
      "select id, source, title, summary, published_at from news_items where id = $1",
      [newsId]
    );

    if (newsResult.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "News item not found");
    }

    const matchResult = await query<{ name: string; ticker: string }>(
      "select instruments.name, listings.ticker from news_matches join instruments on instruments.id = news_matches.instrument_id join listings on listings.instrument_id = instruments.id where news_matches.news_id = $1",
      [newsId]
    );

    const related = matchResult.rows
      .map((row) => `${row.name} (${row.ticker})`)
      .join("\n");

    const inputData = {
      news_id: newsId,
      title: newsResult.rows[0].title,
      source: newsResult.rows[0].source,
      published_at: newsResult.rows[0].published_at,
      summary: newsResult.rows[0].summary ?? "",
      related_instruments: related || "None",
    };

    const cacheKey = buildCacheKey(inputData);
    const cached = await findCachedAnalysis(orgId, "NEWS_SUMMARY", newsId, cacheKey);
    if (cached) {
      return sendData(res, cached);
    }

    const template = loadPrompt("news_summary.txt");
    const prompt = renderPrompt(template, {
      title: String(inputData.title),
      source: String(inputData.source),
      published_at: String(inputData.published_at),
      summary: String(inputData.summary),
      related_instruments: String(inputData.related_instruments),
    });

    const start = Date.now();
    const llmResponse = await callLlm(prompt, inputData);
    const duration = Date.now() - start;
    const expiresAt = new Date(Date.now() + analysisExpiry("NEWS_SUMMARY"));

    const analysisId = await storeAnalysis({
      orgId,
      entityType: "news",
      entityId: newsId,
      analysisType: "NEWS_SUMMARY",
      promptTemplate: "prompts/news_summary.txt",
      model: llmResponse.model,
      inputData,
      responseText: llmResponse.text,
      metadata: {
        cache_key: cacheKey,
        user_id: String(userId),
        duration_ms: duration,
        tokens_used: llmResponse.usage?.total_tokens ?? null,
      },
      expiresAt,
    });

    await logEvent(orgId, "LLM_ANALYSIS", {
      source: "api",
      status: "ok",
      analysis_type: "NEWS_SUMMARY",
      analysis_id: analysisId,
    });

    return sendData(res, { id: analysisId, response_text: llmResponse.text });
  } catch (err) {
    return next(err);
  }
});

router.post("/analysis/strategy-suggestion", async (req, res, next) => {
  try {
    if (!llmEnabled()) {
      return sendError(res, 400, "LLM_DISABLED", "LLM is disabled");
    }
    const orgId = req.orgId ?? 0;
    const userId = req.user?.id ?? 0;

    const limits = await enforceRateLimits(orgId, userId);
    if (!limits.allowed) {
      return sendError(res, 429, "RATE_LIMITED", limits.message ?? "Rate limit exceeded");
    }

    const positionsData = await getPositionsData(orgId, Number(req.body?.portfolio_id ?? 0), new Date().toISOString().slice(0, 10));
    const snapshot = positionsData.positions
      .map((pos) => `${pos.ticker ?? "—"} qty ${pos.quantity}`)
      .slice(0, 10)
      .join("\n");

    const inputData = {
      portfolio_snapshot: snapshot || "No holdings",
    };

    const cacheKey = buildCacheKey(inputData);
    const cached = await findCachedAnalysis(orgId, "STRATEGY_SUGGESTION", null, cacheKey);
    if (cached) {
      return sendData(res, cached);
    }

    const template = loadPrompt("strategy_suggestion.txt");
    const prompt = renderPrompt(template, {
      portfolio_snapshot: String(inputData.portfolio_snapshot),
    });

    const start = Date.now();
    const llmResponse = await callLlm(prompt, inputData);
    const duration = Date.now() - start;
    const expiresAt = new Date(Date.now() + analysisExpiry("STRATEGY_SUGGESTION"));

    const analysisId = await storeAnalysis({
      orgId,
      entityType: "strategy",
      entityId: null,
      analysisType: "STRATEGY_SUGGESTION",
      promptTemplate: "prompts/strategy_suggestion.txt",
      model: llmResponse.model,
      inputData,
      responseText: llmResponse.text,
      metadata: {
        cache_key: cacheKey,
        user_id: String(userId),
        duration_ms: duration,
        tokens_used: llmResponse.usage?.total_tokens ?? null,
      },
      expiresAt,
    });

    await logEvent(orgId, "LLM_ANALYSIS", {
      source: "api",
      status: "ok",
      analysis_type: "STRATEGY_SUGGESTION",
      analysis_id: analysisId,
    });

    return sendData(res, { id: analysisId, response_text: llmResponse.text });
  } catch (err) {
    return next(err);
  }
});

export { router as analysisRouter };
