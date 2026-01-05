import type {
  FXRate,
  InstrumentMetadata,
  InstrumentSearchResult,
  MarketDataProvider,
  PriceData,
} from "./types";

export class YfinanceProvider implements MarketDataProvider {
  constructor(private baseUrl: string) {}

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`yfinance request failed (${response.status}): ${text}`);
    }
    return (await response.json()) as T;
  }

  async fetchPrices(tickers: string[], from: string, to: string): Promise<PriceData[]> {
    if (tickers.length === 0) {
      return [];
    }
    return this.post<PriceData[]>("/prices", {
      tickers,
      start: from,
      end: to,
    });
  }

  async fetchInstrumentInfo(ticker: string): Promise<InstrumentMetadata> {
    return this.post<InstrumentMetadata>("/instrument-info", { ticker });
  }

  async fetchFXRates(pairs: string[], date: string): Promise<FXRate[]> {
    if (pairs.length === 0) {
      return [];
    }
    return this.post<FXRate[]>("/fx-rates", { pairs, date });
  }

  async searchInstruments(query: string): Promise<InstrumentSearchResult[]> {
    return this.post<InstrumentSearchResult[]>("/search", { query });
  }
}
