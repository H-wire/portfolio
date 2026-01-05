import { query } from "../db";
import { upsertDividend, upsertStockSplit } from "../services/corporateActions";
import { completeJobRun, failJobRun, logEvent, recordFailedJob, startJobRun, withAdvisoryLock } from "./jobUtils";

const LOCK_ID = 1202;
const SOURCE = "yfinance";

type CorporateActionsResponse = {
  ticker: string;
  dividends: Array<{ date: string; dividend: number }>;
  splits: Array<{ date: string; numerator: number; denominator: number }>;
};

export async function runCorporateActionsImportJob() {
  return withAdvisoryLock(LOCK_ID, async () => {
    const jobRunId = await startJobRun("corporate_actions_import");
    const yfinanceBaseUrl = process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8001";

    const listings = await query<{ listing_id: number; ticker: string; currency: string | null }>(
      `select distinct listings.id as listing_id,
              listings.ticker,
              listings.currency
       from listings
       where listings.active = true
         and listings.id in (
           select distinct listing_id from transactions
           union
           select distinct wi.listing_id
           from watchlist_items wi
           join watchlists w on w.id = wi.watchlist_id
         )`
    );

    let dividendsUpserted = 0;
    let splitsUpserted = 0;
    const errors: Array<{ listing_id: number; error: string }> = [];

    try {
      for (const listing of listings.rows) {
        try {
          const response = await fetch(`${yfinanceBaseUrl}/corporate-actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker: listing.ticker }),
          });
          if (!response.ok) {
            throw new Error(`yfinance corporate actions failed: ${response.status}`);
          }
          const payload = (await response.json()) as CorporateActionsResponse;

          for (const dividend of payload.dividends ?? []) {
            await upsertDividend(listing.listing_id, dividend, listing.currency ?? null, SOURCE, {
              ticker: payload.ticker,
            });
            dividendsUpserted += 1;
          }

          for (const split of payload.splits ?? []) {
            await upsertStockSplit(listing.listing_id, split, SOURCE, { ticker: payload.ticker });
            splitsUpserted += 1;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          errors.push({ listing_id: listing.listing_id, error: message });
          await recordFailedJob(
            "corporate_actions_import",
            message,
            { listing_id: listing.listing_id, ticker: listing.ticker },
            "listing",
            listing.listing_id
          );
        }
      }

      await completeJobRun(jobRunId);
      const orgs = await query<{ id: number }>("select id from orgs");
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "CORPORATE_ACTIONS_IMPORT", "job", null, {
            source: "job",
            status: "ok",
            counts: { dividends: dividendsUpserted, splits: splitsUpserted, errors: errors.length },
            errors,
          })
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await failJobRun(jobRunId, message);
      const orgs = await query<{ id: number }>("select id from orgs");
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "CORPORATE_ACTIONS_IMPORT", "job", null, {
            source: "job",
            status: "error",
            errors: [{ error: message }],
          })
        )
      );
      throw err;
    }
  });
}
