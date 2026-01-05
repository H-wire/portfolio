import { YfinanceProvider } from "./yfinance";
import type { MarketDataProvider } from "./types";

export function getMarketDataProvider(): MarketDataProvider {
  const provider = (process.env.MARKET_DATA_PROVIDER ?? "yfinance").toLowerCase();
  if (provider === "yfinance") {
    const baseUrl = process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8001";
    return new YfinanceProvider(baseUrl);
  }
  throw new Error(`Unsupported market data provider: ${provider}`);
}
