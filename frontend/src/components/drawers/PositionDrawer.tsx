import type { ChartData } from "chart.js";
import { Line } from "react-chartjs-2";
import type {
  FundamentalsSnapshot,
  HoldingTransaction,
  ListingPriceAvailability,
  Position,
} from "../../types";

export type PositionDrawerProps = {
  open: boolean;
  position: Position | null;
  onClose: () => void;
  listingRange: "90D" | "YTD" | "ALL";
  onRangeChange: (value: "90D" | "YTD" | "ALL") => void;
  availability: ListingPriceAvailability | null | undefined;
  backfillLoading: boolean;
  backfillError: string | null;
  onBackfill: () => void;
  pricesLoading: boolean;
  chartData: ChartData<"line", number[], string>;
  hasChartData: boolean;
  onViewAll: () => void;
  holdingLedger: HoldingTransaction[];
  holdingLedgerLoading: boolean;
  onDeleteLedger: (row: HoldingTransaction) => void;
  fundamentalsLoading: boolean;
  fundamentals: FundamentalsSnapshot | null | undefined;
  formatMoney: (value: number | null, currency?: string) => string;
  formatMetric: (value: number | string | null) => string;
};

export function PositionDrawer(props: PositionDrawerProps) {
  if (!props.open || !props.position) {
    return null;
  }

  const availability = props.availability;

  return (
    <div className="drawer-backdrop" onClick={props.onClose}>
      <div className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <h3>
              {props.position.instrument_name ?? "Position"}{" "}
              <span className="muted">{props.position.ticker ?? ""}</span>
            </h3>
            <span className="muted">Last updated {props.position.price_date ?? "—"}</span>
          </div>
          <button className="ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
        <div className="drawer-section">
          <div className="drawer-header">
            <h4>Price trend</h4>
            <div className="range-toggle">
              {["90D", "YTD", "ALL"].map((range) => (
                <button
                  key={range}
                  className={props.listingRange === range ? "chip active" : "chip"}
                  onClick={() => props.onRangeChange(range as "90D" | "YTD" | "ALL")}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
          <div className="range-actions">
            <span className="muted">
              {availability?.start_date ? `First buy ${availability.start_date}` : "First buy date not found"}
              {availability?.earliest_price_date
                ? ` · Available ${availability.earliest_price_date} → ${availability.latest_price_date ?? "—"}`
                : ""}
            </span>
            <button className="ghost" onClick={props.onBackfill} disabled={props.backfillLoading}>
              {props.backfillLoading ? "Fetching…" : "Fetch history (1Y pre-buy)"}
            </button>
            {props.backfillError && <span className="error">{props.backfillError}</span>}
          </div>
          {availability?.missing_from_start && (
            <div className="notice">
              <span>
                Price history available from {availability.earliest_price_date ?? "—"}. First buy was {availability.start_date}.
              </span>
              <button className="ghost" onClick={props.onBackfill} disabled={props.backfillLoading}>
                {props.backfillLoading ? "Fetching…" : "Fetch history"}
              </button>
              {props.backfillError && <span className="error">{props.backfillError}</span>}
            </div>
          )}
          {!props.pricesLoading && !props.hasChartData && availability?.latest_price_date && (
            <div className="notice">
              <span>
                No prices in this range. Available {availability.earliest_price_date ?? "—"} → {availability.latest_price_date ?? "—"}.
              </span>
              <button className="ghost" onClick={props.onViewAll}>View ALL</button>
            </div>
          )}
          {props.pricesLoading ? (
            <div className="empty">Loading price history…</div>
          ) : props.hasChartData ? (
            <div className="chart-wrap small">
              <Line data={props.chartData} options={{ responsive: true, maintainAspectRatio: false }} />
            </div>
          ) : (
            <div className="empty">No price data yet</div>
          )}
        </div>
        <div className="drawer-section">
          <h4>Activity</h4>
          {props.holdingLedgerLoading ? (
            <div className="empty">Loading activity…</div>
          ) : props.holdingLedger.length ? (
            <div className="table ledger-table">
              <div className="table-header">
                <span>Date</span>
                <span>Type</span>
                <span>Qty</span>
                <span>Price</span>
                <span>Run Qty</span>
                <span></span>
              </div>
              {props.holdingLedger.map((row) => (
                <div key={row.id} className="table-row">
                  <span>{row.trade_date.slice(0, 10)}</span>
                  <span>{row.type}</span>
                  <span>{row.quantity}</span>
                  <span>{row.price === null ? "—" : props.formatMoney(row.price, row.currency)}</span>
                  <span>{row.running_quantity}</span>
                  <button
                    type="button"
                    className="ghost danger compact"
                    onClick={() => props.onDeleteLedger(row)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">No transactions yet</div>
          )}
        </div>
        <div className="drawer-section">
          <h4>Fundamentals</h4>
          {props.fundamentalsLoading ? (
            <div className="empty">Loading fundamentals…</div>
          ) : props.fundamentals ? (
            <div className="fundamentals-grid">
              <div>
                <span className="muted">As of</span>
                <strong>{props.fundamentals.as_of_date?.slice(0, 10)}</strong>
              </div>
              <div>
                <span className="muted">EPS TTM</span>
                <strong>{props.formatMetric(props.fundamentals.eps_ttm)}</strong>
              </div>
              <div>
                <span className="muted">Revenue TTM</span>
                <strong>{props.formatMetric(props.fundamentals.revenue_ttm)}</strong>
              </div>
              <div>
                <span className="muted">EBITDA TTM</span>
                <strong>{props.formatMetric(props.fundamentals.ebitda_ttm)}</strong>
              </div>
              <div>
                <span className="muted">Net income TTM</span>
                <strong>{props.formatMetric(props.fundamentals.net_income_ttm)}</strong>
              </div>
              <div>
                <span className="muted">Income tax TTM</span>
                <strong>{props.formatMetric(props.fundamentals.income_tax_expense_ttm)}</strong>
              </div>
              <div>
                <span className="muted">Operating CF TTM</span>
                <strong>{props.formatMetric(props.fundamentals.operating_cashflow_ttm)}</strong>
              </div>
              <div>
                <span className="muted">Capex TTM</span>
                <strong>{props.formatMetric(props.fundamentals.capital_expenditure_ttm)}</strong>
              </div>
              <div>
                <span className="muted">EBIT TTM</span>
                <strong>{props.formatMetric(props.fundamentals.ebit_ttm)}</strong>
              </div>
              <div>
                <span className="muted">Tax rate</span>
                <strong>{props.formatMetric(props.fundamentals.tax_rate)}</strong>
              </div>
              <div>
                <span className="muted">Total debt</span>
                <strong>{props.formatMetric(props.fundamentals.total_debt)}</strong>
              </div>
              <div>
                <span className="muted">Total equity</span>
                <strong>{props.formatMetric(props.fundamentals.total_equity)}</strong>
              </div>
              <div>
                <span className="muted">Cash & equivalents</span>
                <strong>{props.formatMetric(props.fundamentals.cash_and_equivalents)}</strong>
              </div>
              <div>
                <span className="muted">Shares outstanding</span>
                <strong>{props.formatMetric(props.fundamentals.shares_outstanding)}</strong>
              </div>
              <div>
                <span className="muted">Source</span>
                <strong>{props.fundamentals.source}</strong>
              </div>
              <details className="fundamentals-raw">
                <summary>Raw fundamentals (Yahoo)</summary>
                <pre>{JSON.stringify(props.fundamentals.raw ?? {}, null, 2)}</pre>
              </details>
            </div>
          ) : (
            <div className="empty">No fundamentals yet</div>
          )}
        </div>
        <div className="drawer-section">
          <h4>Latest news</h4>
          <div className="empty">No news connected</div>
        </div>
      </div>
    </div>
  );
}
