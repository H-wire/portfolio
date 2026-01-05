export type NewsItem = {
  source: string;
  title: string;
  summary: string | null;
  url: string;
  published_at: string;
  raw: Record<string, unknown>;
  tickers?: string[];
};

export interface NewsProvider {
  fetchNews(params: { since: string; query?: string; tickers?: string[]; limit?: number }): Promise<NewsItem[]>;
}
