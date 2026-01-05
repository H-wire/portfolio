import type { ChartData, ChartOptions } from "chart.js";
import { Line } from "react-chartjs-2";
import type { DashboardSummary, Recommendation, RecommendationItem } from "../../types";

export type DashboardSectionProps = {
  summaryLoading: boolean;
  summary: DashboardSummary | null | undefined;
  recommendationsCount: number | string;
  baseCurrency: string;
  totalValue: number | null;
  formatMoney: (value: number | null, currency?: string) => string;
  formatPercent: (value: number) => string;
  chartView: "value" | "pnl" | "indexed";
  onChartViewChange: (value: "value" | "pnl" | "indexed") => void;
  chartRange: "30D" | "90D" | "YTD";
  onChartRangeChange: (value: "30D" | "90D" | "YTD") => void;
  chartData: ChartData<"line", number[], string>;
  chartOptions: ChartOptions<"line">;
  performanceLoading: boolean;
  performanceHasData: boolean;
  onPortfolioAnalysis: () => void;
  portfolioAnalysisLoading: boolean;
  portfolioAnalysisError: string | null;
  recommendationItems: RecommendationItem[];
  recommendationsLoading: boolean;
  formatScore: (value: number | null) => string;
  onExplainRecommendation: (listingId: number) => void;
  recommendationRiskLevel: string;
  onRecommendationRiskLevelChange: (value: string) => void;
  recommendationTopN: string;
  onRecommendationTopNChange: (value: string) => void;
  onRunRecommendations: () => void;
  recommendationRunning: boolean;
  recommendationError: string | null;
  recommendationsMeta?: Recommendation | null;
  onViewStrategy: () => void;
};

export function DashboardSection(props: DashboardSectionProps) {
  const summary = props.summary;

  return (
    <>
      <div className="card span-2">
        <div className="card-header">
          <h3>Today at a glance</h3>
          <span className="muted">{summary?.last_price_date ?? "—"}</span>
        </div>
        {props.summaryLoading ? (
          <div className="empty">Loading summary…</div>
        ) : (
          <div className="summary-grid">
            <div>
              <span className="label">Day PnL</span>
              <strong className={(summary?.pnl_day_base?.absolute ?? 0) >= 0 ? "pos" : "neg"}>
                {summary
                  ? `${props.formatMoney(summary.pnl_day_base.absolute, props.baseCurrency)} (${props.formatPercent(
                      summary.pnl_day_base.percent
                    )})`
                  : "—"}
              </strong>
            </div>
            <div>
              <span className="label">Recommendations</span>
              <strong>{props.recommendationsCount}</strong>
            </div>
            <div>
              <span className="label">Positions up/down</span>
              <strong>
                {summary
                  ? `${summary.count_positions_up_today} / ${summary.count_positions_down_today}`
                  : "—"}
              </strong>
            </div>
            <div>
              <span className="label">Total value</span>
              <strong>
                {summary ? props.formatMoney(summary.total_market_value_base, props.baseCurrency) : "—"}
              </strong>
            </div>
          </div>
        )}
      </div>

      <div className="card span-2">
        <div className="card-header">
          <h3>Portfolio Chart</h3>
          <span className="muted">{props.formatMoney(props.totalValue, props.baseCurrency)}</span>
        </div>
        <div className="card-toggles">
          <div className="toggle-group">
            {[
              { label: "Portfolio Value", value: "value" },
              { label: "PnL", value: "pnl" },
              { label: "Indexed (100)", value: "indexed" },
            ].map((option) => (
              <button
                key={option.value}
                className={props.chartView === option.value ? "toggle active" : "toggle"}
                onClick={() => props.onChartViewChange(option.value as "value" | "pnl" | "indexed")}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="toggle-group">
            {[
              { label: "30D", value: "30D" },
              { label: "90D", value: "90D" },
              { label: "YTD", value: "YTD" },
            ].map((option) => (
              <button
                key={option.value}
                className={props.chartRange === option.value ? "toggle active" : "toggle"}
                onClick={() => props.onChartRangeChange(option.value as "30D" | "90D" | "YTD")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="card-actions">
          <button onClick={props.onPortfolioAnalysis} disabled={props.portfolioAnalysisLoading}>
            {props.portfolioAnalysisLoading ? "Analyzing..." : "AI Portfolio Review"}
          </button>
          {props.portfolioAnalysisError && <span className="error">{props.portfolioAnalysisError}</span>}
        </div>
        <div className="chart-wrap">
          {props.performanceLoading ? (
            <div className="empty">Loading performance…</div>
          ) : props.performanceHasData ? (
            <Line data={props.chartData} options={props.chartOptions} />
          ) : (
            <div className="empty">No performance data yet</div>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Monthly Recommendations</h3>
        <div className="signals">
          {props.recommendationsLoading && <div className="empty">Loading recommendations…</div>}
          {props.recommendationItems.map((item) => (
            <div key={item.listing_id} className="signal-row recommendation-row">
              <div>
                <strong>{item.ticker}</strong>
                <span>Total score {props.formatScore(item.total_score)}</span>
                <span
                  className={
                    item.recommended
                      ? "status-pill status-pill--ok"
                      : item.eligible
                        ? "status-pill"
                        : "status-pill status-pill--bad"
                  }
                >
                  {item.recommended
                    ? "Recommended"
                    : item.eligible
                      ? "Eligible (not in top N)"
                      : "Excluded (failed filters)"}
                </span>
                <span className="muted">{item.reason}</span>
              </div>
              <button className="ghost" onClick={() => props.onExplainRecommendation(item.listing_id)}>
                Explain
              </button>
              <div className="score-bars">
                {([
                  { label: "Q", value: item.scores.quality },
                  { label: "T", value: item.scores.trend },
                  { label: "RS", value: item.scores.rs },
                  { label: "Ti", value: item.scores.timing },
                  { label: "V", value: item.scores.vol },
                ] as const).map((score) => (
                  <div key={score.label} className="score-bar">
                    <span>{score.label}</span>
                    <div className="bar">
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.min(100, Math.max(0, score.value ?? 0))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {(!props.recommendationItems.length && !props.recommendationsLoading && (
            <div className="empty">No recommendations yet</div>
          )) || null}
        </div>
        <div className="score-legend">Q = Quality · T = Trend · RS = Relative Strength · Ti = Timing · V = Volatility</div>
        <div className="recommendation-controls">
          <label>
            Risk level (1-10)
            <input value={props.recommendationRiskLevel} onChange={(e) => props.onRecommendationRiskLevelChange(e.target.value)} />
          </label>
          <label>
            Top N
            <input value={props.recommendationTopN} onChange={(e) => props.onRecommendationTopNChange(e.target.value)} />
          </label>
          <button onClick={props.onRunRecommendations} disabled={props.recommendationRunning}>
            {props.recommendationRunning ? "Running…" : "Run recommendations"}
          </button>
          <button className="ghost" onClick={props.onViewStrategy}>
            View strategy
          </button>
          {props.recommendationError && <p className="error">{props.recommendationError}</p>}
          {props.recommendationsMeta && (
            <p className="muted">
              As of {props.recommendationsMeta.as_of_month} · Risk {props.recommendationsMeta.risk_level}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
