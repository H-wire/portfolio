import { createRecommendations } from "../src/services/recommendations";
import { query } from "../src/db";
import { getLatestFundamentals } from "../src/services/fundamentals";

jest.mock("../src/db", () => ({
  query: jest.fn(),
}));

jest.mock("../src/services/fundamentals", () => ({
  getLatestFundamentals: jest.fn(),
}));

type QueryCall = [string, unknown[] | undefined];

function buildPrices(listingId: number, startDate: string, days: number, startPrice: number) {
  const rows: Array<{ date: string; open: string; high: string; low: string; close: string }> = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const date = new Date(start.getTime());
    date.setDate(start.getDate() + i);
    const price = startPrice + i * 0.1;
    rows.push({
      date: date.toISOString().slice(0, 10),
      open: price.toFixed(2),
      high: (price + 1).toFixed(2),
      low: (price - 1).toFixed(2),
      close: price.toFixed(2),
    });
  }
  return rows;
}

describe("recommendations", () => {
  it("creates recommendations with top ranked items", async () => {
    const pricesA = buildPrices(1, "2024-01-01", 400, 100);
    const pricesB = buildPrices(2, "2024-01-01", 400, 80);

    (getLatestFundamentals as jest.Mock).mockImplementation((instrumentId: number) => {
      if (instrumentId === 10) {
        return Promise.resolve({
          eps_ttm: "2",
          operating_cashflow_ttm: "100",
          ebit_ttm: "120",
          tax_rate: "0.2",
          total_debt: "100",
          total_equity: "300",
          cash_and_equivalents: "50",
          as_of_date: "2024-12-31",
          created_at: new Date(),
        });
      }
      return Promise.resolve({
        eps_ttm: "1",
        operating_cashflow_ttm: "50",
        ebit_ttm: "60",
        tax_rate: "0.25",
        total_debt: "80",
        total_equity: "200",
        cash_and_equivalents: "30",
        as_of_date: "2024-12-31",
        created_at: new Date(),
      });
    });

    (query as jest.Mock).mockImplementation((text: string, params?: unknown[]) => {
      if (text.includes("from listings")) {
        return Promise.resolve({
          rows: [
            { listing_id: 1, instrument_id: 10, ticker: "AAA" },
            { listing_id: 2, instrument_id: 20, ticker: "BBB" },
          ],
        });
      }
      if (text.includes("from prices_eod")) {
        const listingId = params?.[0];
        return Promise.resolve({
          rows: listingId === 1 ? pricesA : pricesB,
        });
      }
      if (text.includes("insert into recommendations")) {
        return Promise.resolve({ rows: [{ id: 1 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await createRecommendations(1, 1, 5, 2);

    expect(result.items.length).toBeGreaterThan(0);
    const tickers = result.items.map((item) => item.ticker);
    expect(tickers).toContain("AAA");
  });
});
