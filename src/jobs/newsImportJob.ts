import { query } from "../db";
import { getNewsProvider } from "../news";
import { failJobRun, logEvent, recordFailedJob, startJobRun, completeJobRun, withAdvisoryLock } from "./jobUtils";

const LOCK_ID = 1003;

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalize(text: string) {
  return text.toLowerCase();
}

function matchConfidence(
  text: string,
  instrument: { isin: string | null; name: string; ticker: string | null },
  tickers?: string[]
) {
  const hay = normalize(text);
  const ticker = instrument.ticker ? normalize(instrument.ticker) : null;
  if (tickers && ticker && tickers.some((value) => normalize(value) === ticker)) {
    return { confidence: 0.8, basis: "ticker" as const };
  }
  if (ticker && hay.includes(ticker)) {
    return { confidence: 0.8, basis: "ticker" as const };
  }
  if (instrument.isin && hay.includes(normalize(instrument.isin))) {
    return { confidence: 1.0, basis: "isin" as const };
  }
  if (hay.includes(normalize(instrument.name))) {
    return { confidence: 0.6, basis: "name" as const };
  }
  return { confidence: 0, basis: "name" as const };
}

function buildQuery(items: Array<{ name: string | null; ticker: string | null }>) {
  const fallback = process.env.NEWS_QUERY ?? "stocks OR equities OR market OR earnings";
  const terms: string[] = [];
  for (const item of items) {
    const name = item.name?.trim();
    const ticker = item.ticker?.trim();
    if (name) {
      const safe = name.replace(/"/g, "");
      terms.push(safe.includes(" ") ? `"${safe}"` : safe);
    }
    if (ticker) {
      const safeTicker = ticker.replace(/"/g, "");
      terms.push(safeTicker);
    }
  }
  const unique = Array.from(new Set(terms)).filter(Boolean).slice(0, 20);
  if (unique.length === 0) {
    return fallback;
  }
  return unique.join(" OR ");
}

export async function runNewsImportJob() {
  return withAdvisoryLock(LOCK_ID, async () => {
    const jobRunId = await startJobRun("news_import");
    const provider = getNewsProvider();
    const since = formatDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

    let inserted = 0;
    let matched = 0;
    const errors: Array<{ url: string; error: string }> = [];

    try {
      const instruments = await query<{ id: number; isin: string | null; name: string; ticker: string | null }>(
        "select instruments.id, instruments.isin, instruments.name, listings.ticker from listings join instruments on instruments.id = listings.instrument_id"
      );
      const queryText = buildQuery(instruments.rows);
      const tickerList = Array.from(
        new Set(instruments.rows.map((row) => row.ticker).filter((ticker): ticker is string => Boolean(ticker)))
      );

      const news = await provider.fetchNews({ since, query: queryText, tickers: tickerList, limit: 10 });

      for (const item of news) {
        try {
          const result = await query<{ id: number }>(
            "insert into news_items (source, title, published_at, url, summary, raw) values ($1, $2, $3, $4, $5, $6) on conflict (url) do update set summary = excluded.summary returning id",
            [item.source, item.title, item.published_at, item.url, item.summary, item.raw]
          );
          inserted += 1;
          const newsId = result.rows[0].id;

          const text = `${item.title} ${item.summary ?? ""}`;
          for (const instrument of instruments.rows) {
            const match = matchConfidence(text, instrument, item.tickers);
            if (match.confidence > 0) {
              await query(
                "insert into news_matches (news_id, instrument_id, confidence, match_basis) values ($1, $2, $3, $4) on conflict (news_id, instrument_id) do update set confidence = excluded.confidence, match_basis = excluded.match_basis",
                [newsId, instrument.id, match.confidence, match.basis]
              );
              matched += 1;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          errors.push({ url: item.url, error: message });
          await recordFailedJob("news_import", message, { url: item.url }, "news");
        }
      }

      await completeJobRun(jobRunId);
      const orgs = await query<{ id: number }>("select id from orgs");
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "NEWS_IMPORT", "job", null, {
            source: "job",
            status: "ok",
            counts: { inserted, matched, errors: errors.length },
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
          logEvent(org.id, "NEWS_IMPORT", "job", null, {
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
