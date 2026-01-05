import { getMarketDataProvider } from "../marketdata";
import { query } from "../db";
import { failJobRun, logEvent, recordFailedJob, startJobRun, completeJobRun, withAdvisoryLock } from "./jobUtils";

const LOCK_ID = 1001;

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

async function logOrgEvent(payload: Record<string, unknown>) {
  const orgs = await query<{ id: number }>("select id from orgs");
  await Promise.all(
    orgs.rows.map((org) =>
      logEvent(org.id, "PRICE_IMPORT", "job", null, {
        source: "job",
        status: payload.status ?? "ok",
        ...payload,
      })
    )
  );
}

export async function runPriceImportJob() {
  return withAdvisoryLock(LOCK_ID, async () => {
    const jobRunId = await startJobRun("price_import");
    const provider = getMarketDataProvider();

    let inserted = 0;
    let updated = 0;
    const errors: Array<{ listing_id: number; error: string }> = [];

    try {
      const listings = await query<{
        id: number;
        ticker: string;
      }>("select id, ticker from listings where active = true");

      const today = formatDate(new Date());
      for (const listing of listings.rows) {
        try {
          const last = await query<{ date: string | null }>(
            "select max(date) as date from prices_eod where listing_id = $1",
            [listing.id]
          );
          const lastDate = last.rows[0]?.date;
          const startDate = lastDate
            ? formatDate(addDays(new Date(`${lastDate}T00:00:00Z`), 1))
            : formatDate(addDays(new Date(), -365));

          if (startDate > today) {
            continue;
          }

          const prices = await provider.fetchPrices([listing.ticker], startDate, today);
          if (prices.length === 0) {
            continue;
          }

          for (const price of prices) {
            await query(
              "insert into prices_eod (listing_id, date, open, high, low, close, adj_close, volume) values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (listing_id, date) do update set open = excluded.open, high = excluded.high, low = excluded.low, close = excluded.close, adj_close = excluded.adj_close, volume = excluded.volume",
              [
                listing.id,
                price.date,
                price.open,
                price.high,
                price.low,
                price.close,
                price.adj_close ?? null,
                price.volume,
              ]
            );
            inserted += 1;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          errors.push({ listing_id: listing.id, error: message });
          await recordFailedJob("price_import", message, { listing_id: listing.id }, "listing", listing.id);
        }
      }

      await completeJobRun(jobRunId);
      await logOrgEvent({
        status: "ok",
        counts: { inserted, updated, errors: errors.length },
        errors,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await failJobRun(jobRunId, message);
      await logOrgEvent({
        status: "error",
        errors: [{ error: message }],
      });
      throw err;
    }
  });
}
