import type { NewsItem, NewsProvider } from "./types";

type YfinanceNewsItem = {
  ticker: string;
  source: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: string;
  raw: Record<string, unknown>;
};

export class YfinanceNewsProvider implements NewsProvider {
  constructor(private baseUrl: string) {}

  async fetchNews(params: { since: string; query?: string; tickers?: string[]; limit?: number }) {
    const tickers = params.tickers ?? [];
    if (tickers.length === 0) {
      return [] as NewsItem[];
    }
    const response = await fetch(`${this.baseUrl}/news`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tickers, limit: params.limit ?? 10 }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`yfinance news failed (${response.status}): ${text}`);
    }
    const data = (await response.json()) as YfinanceNewsItem[];
    return data.map((item) => ({
      source: item.source,
      title: item.title,
      summary: item.summary ?? null,
      url: item.url,
      published_at: item.published_at,
      raw: item.raw,
      tickers: item.ticker ? [item.ticker] : [],
    }));
  }
}
