import { Router } from "express";
import { query } from "../db";
import { sendData, sendError } from "../http";

const router = Router({ mergeParams: true });

router.get("/news", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const portfolioId = req.query.portfolioId ? Number(req.query.portfolioId) : null;

    if (portfolioId !== null && !Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    let instrumentIds: number[] = [];
    if (portfolioId) {
      const listings = await query<{ instrument_id: number }>(
        "select distinct listings.instrument_id from transactions join listings on listings.id = transactions.listing_id where transactions.org_id = $1 and transactions.portfolio_id = $2",
        [orgId, portfolioId]
      );
      instrumentIds = listings.rows.map((row) => row.instrument_id);
    }

    const params: Array<number | number[]> = [];
    let whereClause = "";
    if (instrumentIds.length > 0) {
      params.push(instrumentIds);
      whereClause = "where news_matches.instrument_id = any($1)";
    }

    const result = await query<{
      id: number;
      source: string;
      title: string;
      published_at: string;
      url: string;
      summary: string | null;
      match_bases: string[];
    }>(
      `select news_items.id,
              news_items.source,
              news_items.title,
              news_items.published_at,
              news_items.url,
              news_items.summary,
              coalesce(array_remove(array_agg(distinct news_matches.match_basis), null), '{}') as match_bases
       from news_items
       left join news_matches on news_matches.news_id = news_items.id
       ${whereClause}
       group by news_items.id
       order by news_items.published_at desc
       limit 50`,
      params
    );

    return sendData(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

export { router as newsRouter };
