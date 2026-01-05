export type PriceData = {
  ticker: string;
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  adj_close?: number | null;
  volume: number | null;
};

export type InstrumentMetadata = {
  ticker: string;
  name: string;
  currency: string;
  exchange: string;
  sector: string | null;
  country: string | null;
  metadata: Record<string, unknown>;
};

export type FXRate = {
  pair: string;
  date: string;
  rate: number;
};

export type InstrumentSearchResult = {
  ticker: string;
  name: string;
  exchange: string;
};

export interface MarketDataProvider {
  fetchPrices(tickers: string[], from: string, to: string): Promise<PriceData[]>;
  fetchInstrumentInfo(ticker: string): Promise<InstrumentMetadata>;
  fetchFXRates(pairs: string[], date: string): Promise<FXRate[]>;
  searchInstruments(query: string): Promise<InstrumentSearchResult[]>;
}
