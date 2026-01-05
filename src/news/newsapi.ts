import type { NewsItem, NewsProvider } from "./types";

export class NewsApiProvider implements NewsProvider {
  constructor(private baseUrl: string, private apiKey: string) {}

  async fetchNews(params: { since: string; query?: string }): Promise<NewsItem[]> {
    const url = new URL(this.baseUrl);
    const effectiveQuery = params.query ?? process.env.NEWS_QUERY ?? "stocks OR equities OR market OR earnings";
    url.searchParams.set("q", effectiveQuery);
    url.searchParams.set("from", params.since);
    url.searchParams.set("language", "en");
    url.searchParams.set("sortBy", "publishedAt");
    url.searchParams.set("pageSize", "50");

    const response = await fetch(url.toString(), {
      headers: {
        "X-Api-Key": this.apiKey,
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`News provider failed (${response.status}): ${text}`);
    }
    const data = await response.json();
    return (data.articles ?? []).map((item: any) => ({
      source: item.source?.name ?? "unknown",
      title: item.title ?? "",
      summary: item.description ?? null,
      url: item.url ?? "",
      published_at: item.publishedAt ?? since,
      raw: item,
    }));
  }
}
