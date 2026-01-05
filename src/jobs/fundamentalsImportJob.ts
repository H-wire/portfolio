import { query } from "../db";
import { normalizeYfinanceFundamentals, type YfinanceFundamentalsResponse } from "../fundamentals/yfinanceAdapter";
import { getLatestFundamentals, upsertFundamentalsTtm } from "../services/fundamentals";
import { completeJobRun, failJobRun, logEvent, recordFailedJob, startJobRun, withAdvisoryLock } from "./jobUtils";

const LOCK_ID = 1201;
const SOURCE = "yfinance";

function hoursAgo(hours: number) {
  return Date.now() - hours * 60 * 60 * 1000;
}

function hasMissingFields(latest: Awaited<ReturnType<typeof getLatestFundamentals>> | null) {
  if (!latest) {
    return true;
  }
  const required = [
    latest.revenue_ttm,
    latest.ebitda_ttm,
    latest.net_income_ttm,
    latest.income_tax_expense_ttm,
    latest.operating_cashflow_ttm,
    latest.capital_expenditure_ttm,
    latest.ebit_ttm,
    latest.total_equity,
    latest.total_debt,
    latest.shares_outstanding,
  ];
  return required.some((value) => value === null);
}

export async function runFundamentalsImportJob() {
  return withAdvisoryLock(LOCK_ID, async () => {
    const jobRunId = await startJobRun("fundamentals_import");
    const yfinanceBaseUrl = process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8001";

    const listings = await query<{ listing_id: number; instrument_id: number; ticker: string }>(
      `select distinct listings.id as listing_id,
              listings.instrument_id,
              listings.ticker
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

    let inserted = 0;
    let updated = 0;
    const errors: Array<{ listing_id: number; error: string }> = [];

    try {
      for (const listing of listings.rows) {
        try {
          const latest = await getLatestFundamentals(listing.instrument_id);
          if (
            latest &&
            latest.created_at &&
            new Date(latest.created_at).getTime() > hoursAgo(24) &&
            !hasMissingFields(latest)
          ) {
            continue;
          }

          let normalized: ReturnType<typeof normalizeFmpFundamentals> | null = null;
          let source = SOURCE;
          try {
            const response = await client.fetchFundamentals(listing.ticker);
            normalized = normalizeFmpFundamentals(response);
          } catch {
            normalized = null;
          }

          if (!normalized || normalized.epsTtm === null || normalized.operatingCashflowTtm === null) {
            const yfResponse = await fetch(`${yfinanceBaseUrl}/fundamentals`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ticker: listing.ticker }),
            });
            if (!yfResponse.ok) {
              throw new Error(`yfinance fundamentals failed: ${yfResponse.status}`);
            }
            const yfPayload = (await yfResponse.json()) as YfinanceFundamentalsResponse;
            normalized = normalizeYfinanceFundamentals(yfPayload);
            source = SOURCE;
          }

          if (!normalized) {
            throw new Error("Missing fundamentals payload");
          }

          const wasSameAsOf = latest?.as_of_date === normalized.asOfDate;

          await upsertFundamentalsTtm(listing.instrument_id, source, normalized);
          if (wasSameAsOf) {
            updated += 1;
          } else {
            inserted += 1;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          errors.push({ listing_id: listing.listing_id, error: message });
          await recordFailedJob(
            "fundamentals_import",
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
          logEvent(org.id, "FUNDAMENTALS_IMPORT", "job", null, {
            source: "job",
            status: "ok",
            counts: { inserted, updated, errors: errors.length },
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
          logEvent(org.id, "FUNDAMENTALS_IMPORT", "job", null, {
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
