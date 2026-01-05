import { Router } from "express";
import { query } from "../db";
import { sendData } from "../http";
import { getMarketDataProvider } from "../marketdata";
import { requireAuth } from "../middleware/auth";
import { z } from "zod";

const router = Router();

router.get("/health", async (_req, res, next) => {
  try {
    const nowResult = await query<{ now: Date }>("select now() as now");
    const jobResult = await query<{ last_success: Date | null }>(
      "select max(completed_at) as last_success from job_runs where status = 'completed'"
    );

    let marketDataStatus: string | null = null;
    const yfinanceUrl = process.env.YFINANCE_SERVICE_URL;
    if (yfinanceUrl) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(`${yfinanceUrl}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        marketDataStatus = response.ok ? "ok" : "down";
      } catch {
        marketDataStatus = "down";
      }
    }

    return sendData(res, {
      status: "ok",
      db: true,
      now: nowResult.rows[0]?.now ?? null,
      last_job_success: jobResult.rows[0]?.last_success ?? null,
      market_data: marketDataStatus,
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/market-data/search", requireAuth, async (req, res, next) => {
  try {
    const payload = z.object({ query: z.string().min(1).max(80) }).parse(req.body);
    const provider = getMarketDataProvider();
    const results = await provider.searchInstruments(payload.query);
    return sendData(res, results);
  } catch (err) {
    return next(err);
  }
});

export { router as healthRouter };
