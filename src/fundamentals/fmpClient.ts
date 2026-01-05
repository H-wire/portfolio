import type { FmpBalanceSheetQuarter, FmpCashFlowQuarter, FmpFundamentalsResponse, FmpIncomeQuarter } from "./fmpTypes";

const DEFAULT_BASE_URL = "https://financialmodelingprep.com";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RateLimiter {
  private lastRequestAt = 0;
  constructor(private readonly minIntervalMs: number) {}

  async wait() {
    const now = Date.now();
    const waitFor = this.lastRequestAt + this.minIntervalMs - now;
    if (waitFor > 0) {
      await delay(waitFor);
    }
    this.lastRequestAt = Date.now();
  }
}

export type FmpClientOptions = {
  apiKey: string;
  baseUrl?: string;
  minIntervalMs?: number;
  maxRetries?: number;
};

export class FmpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly limiter: RateLimiter;

  constructor(options: FmpClientOptions) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = options.apiKey;
    this.maxRetries = options.maxRetries ?? 3;
    this.limiter = new RateLimiter(options.minIntervalMs ?? 400);
  }

  private async fetchJson<T>(path: string): Promise<T> {
    let attempt = 0;
    while (attempt <= this.maxRetries) {
      await this.limiter.wait();
      try {
        const response = await fetch(`${this.baseUrl}${path}&apikey=${this.apiKey}`);
        if (!response.ok) {
          throw new Error(`FMP request failed: ${response.status}`);
        }
        return (await response.json()) as T;
      } catch (err) {
        if (attempt >= this.maxRetries) {
          throw err;
        }
        const wait = Math.min(2000 * (attempt + 1), 10000);
        await delay(wait);
        attempt += 1;
      }
    }
    throw new Error("FMP request failed after retries");
  }

  async fetchIncomeStatementQuarterly(symbol: string) {
    return this.fetchJson<FmpIncomeQuarter[]>(
      `/stable/income-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=5`
    );
  }

  async fetchCashFlowQuarterly(symbol: string) {
    return this.fetchJson<FmpCashFlowQuarter[]>(
      `/stable/cash-flow-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=5`
    );
  }

  async fetchBalanceSheet(symbol: string) {
    const data = await this.fetchJson<FmpBalanceSheetQuarter[]>(
      `/stable/balance-sheet-statement?symbol=${encodeURIComponent(symbol)}&period=quarter&limit=1`
    );
    return data[0] ?? null;
  }

  async fetchFundamentals(symbol: string): Promise<FmpFundamentalsResponse> {
    const [income, cashflow, balance] = await Promise.all([
      this.fetchIncomeStatementQuarterly(symbol),
      this.fetchCashFlowQuarterly(symbol),
      this.fetchBalanceSheet(symbol),
    ]);

    return {
      income,
      cashflow,
      balance,
    };
  }
}
