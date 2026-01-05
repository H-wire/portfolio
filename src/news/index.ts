import type { NewsProvider } from "./types";
import { NewsApiProvider } from "./newsapi";
import { YfinanceNewsProvider } from "./yfinance";

class StubNewsProvider implements NewsProvider {
  async fetchNews(_params: { since: string; query?: string }): Promise<[]> {
    return [];
  }
}

class CombinedNewsProvider implements NewsProvider {
  constructor(private providers: NewsProvider[]) {}

  async fetchNews(params: { since: string; query?: string; tickers?: string[]; limit?: number }) {
    const results = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return await provider.fetchNews(params);
        } catch (err) {
          console.warn("News provider failed", err);
          return [] as NewsItem[];
        }
      })
    );
    const merged = results.flat();
    const seen = new Set<string>();
    return merged.filter((item) => {
      if (!item.url) {
        return false;
      }
      if (seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      return true;
    });
  }
}

export function getNewsProvider(): NewsProvider {
  const provider = (process.env.NEWS_PROVIDER ?? "stub").toLowerCase();
  if (provider === "stub") {
    return new StubNewsProvider();
  }
  const baseUrl = process.env.NEWS_BASE_URL ?? "https://newsapi.org/v2/everything";
  const apiKey = process.env.NEWS_API_KEY ?? "";
  const yfinanceUrl = process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8001";

  if (provider === "newsapi") {
    if (!apiKey) {
      throw new Error("NEWS_API_KEY is required for newsapi provider");
    }
    return new NewsApiProvider(baseUrl, apiKey);
  }
  if (provider === "yfinance") {
    return new YfinanceNewsProvider(yfinanceUrl);
  }
  if (provider === "combined") {
    const providers: NewsProvider[] = [new YfinanceNewsProvider(yfinanceUrl)];
    if (apiKey) {
      providers.unshift(new NewsApiProvider(baseUrl, apiKey));
    }
    return new CombinedNewsProvider(providers);
  }
  throw new Error(`Unsupported news provider: ${provider}`);
}
