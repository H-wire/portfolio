import { query } from "../db";
import { getMarketDataProvider } from "../marketdata";
import {
  completeJobRun,
  failJobRun,
  logEvent,
  recordFailedJob,
  startJobRun,
  withAdvisoryLock,
} from "./jobUtils";

const LOCK_ID = 1004;

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

type OrgStats = {
  pairs: number;
  inserted: number;
  errors: Array<{ portfolio_id: number; error: string }>;
};

function ensureOrgStats(map: Map<number, OrgStats>, orgId: number) {
  if (!map.has(orgId)) {
    map.set(orgId, { pairs: 0, inserted: 0, errors: [] });
  }
  return map.get(orgId)!;
}

export async function runFxImportJob() {
  return withAdvisoryLock(LOCK_ID, async () => {
    const jobRunId = await startJobRun("fx_import");
    const provider = getMarketDataProvider();
    const date = formatDate(addDays(new Date(), -1));

    const orgStats = new Map<number, OrgStats>();

    try {
      const portfolios = await query<{ id: number; org_id: number; base_currency: string }>(
        "select id, org_id, base_currency from portfolios"
      );
      const txCurrencies = await query<{ portfolio_id: number; currency: string }>(
        "select distinct portfolio_id, currency from transactions where currency is not null"
      );

      const portfolioCurrencyMap = new Map<number, Set<string>>();
      for (const row of txCurrencies.rows) {
        if (!row.currency) {
          continue;
        }
        if (!portfolioCurrencyMap.has(row.portfolio_id)) {
          portfolioCurrencyMap.set(row.portfolio_id, new Set());
        }
        portfolioCurrencyMap.get(row.portfolio_id)!.add(row.currency.toUpperCase());
      }

      for (const portfolio of portfolios.rows) {
        const stats = ensureOrgStats(orgStats, portfolio.org_id);
        const baseCurrency = portfolio.base_currency.toUpperCase();
        const currencies = Array.from(portfolioCurrencyMap.get(portfolio.id) ?? []).filter(
          (currency) => currency !== baseCurrency
        );
        if (currencies.length === 0) {
          continue;
        }
        const pairs = currencies.map((currency) => `${currency}${baseCurrency}`);
        stats.pairs += pairs.length;

        try {
          const rates = await provider.fetchFXRates(pairs, date);
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
            stats.inserted += 1;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          stats.errors.push({ portfolio_id: portfolio.id, error: message });
          await recordFailedJob(
            "fx_import",
            message,
            { portfolio_id: portfolio.id },
            "portfolio",
            portfolio.id
          );
        }
      }

      await completeJobRun(jobRunId);
      for (const [orgId, stats] of orgStats.entries()) {
        await logEvent(orgId, "FX_IMPORT", "job", null, {
          source: "job",
          status: "ok",
          counts: { pairs: stats.pairs, inserted: stats.inserted, errors: stats.errors.length },
          errors: stats.errors,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await failJobRun(jobRunId, message);
      const orgs = await query<{ id: number }>("select id from orgs");
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "FX_IMPORT", "job", null, {
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
