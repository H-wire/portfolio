import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Filler,
  Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";
import ReactMarkdown from "react-markdown";
import { daysAgo, startOfYearString, todayString, shiftDate } from "./utils/dates";
import { formatMetric, formatMoney, formatNewsMatch, formatPercent, formatScore } from "./utils/format";
import { AddHoldingCard } from "./components/dashboard/AddHoldingCard";
import { AllocationCard } from "./components/dashboard/AllocationCard";
import { DashboardSection } from "./components/dashboard/DashboardSection";
import RegimeDashboard from "./components/RegimeDashboard";
import { NewsCard } from "./components/dashboard/NewsCard";
import { NotificationsCard } from "./components/dashboard/NotificationsCard";
import { PositionsCard } from "./components/dashboard/PositionsCard";
import { PositionDrawer } from "./components/drawers/PositionDrawer";
import { HeroSection } from "./components/layout/HeroSection";
import { ToolbarSection } from "./components/layout/ToolbarSection";
import { LedgerDeleteModal } from "./components/modals/LedgerDeleteModal";
import { PortfolioAnalysisModal } from "./components/modals/PortfolioAnalysisModal";
import { RecommendationExplainModal } from "./components/modals/RecommendationExplainModal";
import { SeedPositionModal } from "./components/modals/SeedPositionModal";
import { StrategyModal } from "./components/modals/StrategyModal";
import {
  apiFetch,
  backfillListingPrices,
  createTransaction,
  deleteTransaction,
  fetchHealth,
  fetchExchanges,
  fetchHoldingTransactions,
  fetchListingPriceAvailability,
  fetchListingPrices,
  fetchListingFundamentals,
  fetchNews,
  fetchNotifications,
  fetchPortfolioSummary,
  fetchPortfolioAnalysis,
  fetchLatestRecommendations,
  fetchFactorScores,
  fetchRecommendationExplanation,
  runRecommendations,
  login,
  markNotificationRead,
  seedPosition,
  searchMarketData,
} from "./api";
import type {
  Allocation,
  AnalysisResult,
  DashboardSummary,
  Exchange,
  HoldingTransaction,
  ListingPriceAvailability,
  ListingPricePoint,
  ListingSearch,
  FundamentalsSnapshot,
  NewsItem,
  Notification,
  Org,
  PerformancePoint,
  Portfolio,
  Position,
  FactorScore,
} from "./types";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler, Legend);



function downsampleSeries<T>(series: T[], maxPoints: number) {
  if (series.length <= maxPoints) {
    return series;
  }
  const step = Math.ceil(series.length / maxPoints);
  const sampled: T[] = [];
  for (let i = 0; i < series.length; i += step) {
    sampled.push(series[i]);
  }
  if (sampled[sampled.length - 1] !== series[series.length - 1]) {
    sampled.push(series[series.length - 1]);
  }
  return sampled;
}

function computeSma(values: number[], period: number) {
  const result: Array<number | null> = [];
  if (period <= 0) {
    return values.map(() => null);
  }
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i + 1 >= period) {
      result.push(sum / period);
    } else {
      result.push(null);
    }
  }
  return result;
}

export default function App() {
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("ChangeMe12345");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(() => Boolean(localStorage.getItem("access_token")));
  const [selectedOrg, setSelectedOrg] = useState<number | null>(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState<number | null>(null);
  const [portfolioName, setPortfolioName] = useState("");
  const [recommendationRiskLevel, setRecommendationRiskLevel] = useState("5");
  const [recommendationTopN, setRecommendationTopN] = useState("3");
  const [recommendationError, setRecommendationError] = useState<string | null>(null);
  const [recommendationRunning, setRecommendationRunning] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [recommendationExplainOpen, setRecommendationExplainOpen] = useState(false);
  const [recommendationExplainLoading, setRecommendationExplainLoading] = useState(false);
  const [recommendationExplainError, setRecommendationExplainError] = useState<string | null>(null);
  const [recommendationExplainResult, setRecommendationExplainResult] = useState<AnalysisResult | null>(null);
  const [portfolioAnalysis, setPortfolioAnalysis] = useState<AnalysisResult | null>(null);
  const [portfolioAnalysisLoading, setPortfolioAnalysisLoading] = useState(false);
  const [portfolioAnalysisOpen, setPortfolioAnalysisOpen] = useState(false);
  const [portfolioAnalysisError, setPortfolioAnalysisError] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<ListingSearch | null>(null);
  const [marketSearchTerm, setMarketSearchTerm] = useState("");
  const [marketSearchResult, setMarketSearchResult] = useState<string | null>(null);
  const [marketSearchError, setMarketSearchError] = useState<string | null>(null);
  const [marketCreateStatus, setMarketCreateStatus] = useState<string | null>(null);
  const [marketCreateSubmitting, setMarketCreateSubmitting] = useState(false);
  const [transactionType, setTransactionType] = useState("BUY");
  const [transactionQty, setTransactionQty] = useState("10");
  const [transactionPrice, setTransactionPrice] = useState("100");
  const [transactionFees, setTransactionFees] = useState("0");
  const [transactionDate, setTransactionDate] = useState(todayString());
  const [holdingError, setHoldingError] = useState<string | null>(null);
  const [transactionSubmitting, setTransactionSubmitting] = useState(false);
  const [transactionSuccess, setTransactionSuccess] = useState<string | null>(null);
  const [chartView, setChartView] = useState<"value" | "pnl" | "indexed">("value");
  const [chartRange, setChartRange] = useState<"30D" | "90D" | "YTD">("30D");
  const [activeView, setActiveView] = useState<"dashboard" | "regime">("dashboard");
  const [allocationView, setAllocationView] = useState<"sector" | "currency" | "country">("sector");
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOpenedAt, setDrawerOpenedAt] = useState<number | null>(null);
  const [suppressBackdropClick, setSuppressBackdropClick] = useState(false);
  const [listingRange, setListingRange] = useState<"90D" | "YTD" | "ALL">("90D");
  const [listingBackfillLoading, setListingBackfillLoading] = useState(false);
  const [listingBackfillError, setListingBackfillError] = useState<string | null>(null);
  const [ledgerDeleteTarget, setLedgerDeleteTarget] = useState<HoldingTransaction | null>(null);
  const [ledgerDeleteError, setLedgerDeleteError] = useState<string | null>(null);
  const [ledgerDeleteLoading, setLedgerDeleteLoading] = useState(false);
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedListingId, setSeedListingId] = useState("");
  const [seedQuantity, setSeedQuantity] = useState("");
  const [seedAvgCost, setSeedAvgCost] = useState("");
  const [seedCurrency, setSeedCurrency] = useState("");
  const [seedFirstBuyDate, setSeedFirstBuyDate] = useState(todayString());
  const [seedNotes, setSeedNotes] = useState("");
  const [seedError, setSeedError] = useState<string | null>(null);
  const [seedSaving, setSeedSaving] = useState(false);
  const [seedListingLocked, setSeedListingLocked] = useState(false);
  const [transactionDebug, setTransactionDebug] = useState<{
    request: Record<string, unknown> | null;
    response: Record<string, unknown> | null;
    error: string | null;
  }>({ request: null, response: null, error: null });


  const meQuery = useQuery({
    queryKey: ["me"],
    enabled: authReady,
    queryFn: () => apiFetch<{ data: { user: { id: number; email: string; name: string | null; last_login_at: string | null }; orgs: Org[] } }>("/me"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const isAuthed = Boolean(meQuery.data?.data?.user);

  useEffect(() => {
    if (!isAuthed || !meQuery.isError) {
      return;
    }
    const message = meQuery.error instanceof Error ? meQuery.error.message : "";
    const shouldClear = /token|unauthorized|user context/i.test(message);
    if (!shouldClear) {
      return;
    }
    localStorage.removeItem("access_token");
    setAuthReady(false);
    setSelectedOrg(null);
    setSelectedPortfolio(null);
    setAuthError("Session expired. Please log in again.");
  }, [authReady, meQuery.error, meQuery.isError]);

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchHealth(),
    refetchInterval: 15000,
  });

  const orgs = meQuery.data?.data.orgs ?? [];
  const orgId = selectedOrg ?? orgs[0]?.org_id ?? null;

  const portfoliosQuery = useQuery({
    queryKey: ["portfolios", orgId],
    enabled: isAuthed && Boolean(orgId),
    queryFn: () => apiFetch<{ data: Portfolio[] }>(`/orgs/${orgId}/portfolios`),
  });

  const portfolios = portfoliosQuery.data?.data ?? [];
  const activePortfolioId = selectedPortfolio ?? portfolios[0]?.id ?? null;
  const activePortfolio = portfolios.find((portfolio) => portfolio.id === activePortfolioId) ?? null;
  const baseCurrency = activePortfolio?.base_currency?.toUpperCase().trim() ?? "SEK";
  const chartFrom = useMemo(() => {
    if (chartRange === "90D") {
      return daysAgo(90);
    }
    if (chartRange === "YTD") {
      return startOfYearString();
    }
    return daysAgo(30);
  }, [chartRange]);
  const chartTo = todayString();

  const positionsQuery = useQuery({
    queryKey: ["positions", orgId, activePortfolioId],
    enabled: isAuthed && Boolean(orgId && activePortfolioId),
    queryFn: () =>
      apiFetch<{ data: Position[] }>(
        `/orgs/${orgId}/portfolios/${activePortfolioId}/positions?date=${todayString()}`
      ),
  });

  const allocationQuery = useQuery({
    queryKey: ["allocation", orgId, activePortfolioId],
    enabled: isAuthed && Boolean(orgId && activePortfolioId),
    queryFn: () =>
      apiFetch<{ data: Allocation }>(
        `/orgs/${orgId}/portfolios/${activePortfolioId}/allocation?date=${todayString()}`
      ),
  });

  const performanceQuery = useQuery({
    queryKey: ["performance", orgId, activePortfolioId, chartFrom, chartTo],
    enabled: isAuthed && Boolean(orgId && activePortfolioId),
    queryFn: () =>
      apiFetch<{ data: PerformancePoint[] }>(
        `/orgs/${orgId}/portfolios/${activePortfolioId}/performance?from=${chartFrom}&to=${chartTo}`
      ),
  });

  const recommendationsQuery = useQuery({
    queryKey: ["recommendations", orgId, activePortfolioId],
    enabled: isAuthed && Boolean(orgId && activePortfolioId),
    queryFn: () =>
      fetchLatestRecommendations(orgId!, activePortfolioId!).then(
        (res) => res as { data: Recommendation | null }
      ),
  });

  const summaryQuery = useQuery({
    queryKey: ["summary", orgId, activePortfolioId],
    enabled: isAuthed && Boolean(orgId && activePortfolioId),
    queryFn: () =>
      fetchPortfolioSummary(orgId!, activePortfolioId!).then((res) => res as { data: DashboardSummary }),
  });

  const factorScoresQuery = useQuery({
    queryKey: ["factorScores", orgId, activePortfolioId],
    enabled: isAuthed && Boolean(orgId && activePortfolioId),
    queryFn: () =>
      fetchFactorScores(orgId!, activePortfolioId!).then(
        (res) => res as { data: FactorScore[]; meta?: { as_of_date?: string } }
      ),
  });

  const newsQuery = useQuery({
    queryKey: ["news", orgId, activePortfolioId],
    enabled: isAuthed && Boolean(orgId),
    queryFn: () => fetchNews(orgId!, activePortfolioId).then((res) => res as { data: NewsItem[] }),
  });

  const notificationsQuery = useQuery({
    queryKey: ["notifications", orgId],
    enabled: isAuthed && Boolean(orgId),
    queryFn: () => fetchNotifications(orgId!).then((res) => res as { data: Notification[] }),
  });

  const exchangesQuery = useQuery({
    queryKey: ["exchanges", orgId],
    enabled: isAuthed && Boolean(orgId),
    queryFn: () => fetchExchanges(orgId!).then((res) => res as { data: Exchange[] }),
  });

  const marketSearchQuery = useQuery({
    queryKey: ["marketSearch", marketSearchTerm],
    enabled: isAuthed && marketSearchTerm.length >= 2,
    queryFn: () => searchMarketData(marketSearchTerm),
  });

  const listingAvailabilityQuery = useQuery({
    queryKey: ["listingPriceAvailability", orgId, activePortfolioId, selectedPosition?.listing_id],
    enabled: isAuthed && Boolean(orgId && activePortfolioId && selectedPosition?.listing_id),
    queryFn: () =>
      fetchListingPriceAvailability(orgId!, activePortfolioId!, selectedPosition!.listing_id).then(
        (res) => res as { data: ListingPriceAvailability }
      ),
  });

  const listingPricesQuery = useQuery({
    queryKey: ["listingPrices", orgId, selectedPosition?.listing_id, listingRange],
    enabled: isAuthed && Boolean(orgId && selectedPosition?.listing_id),
    queryFn: () =>
      fetchListingPrices(orgId!, selectedPosition!.listing_id, {
        range: listingRange,
        portfolioId: listingRange === "ALL" ? activePortfolioId ?? undefined : undefined,
      }).then((res) => res as { data: ListingPricePoint[] }),
  });

  const listingFundamentalsQuery = useQuery({
    queryKey: ["listingFundamentals", orgId, selectedPosition?.listing_id],
    enabled: isAuthed && Boolean(orgId && selectedPosition?.listing_id),
    queryFn: () =>
      fetchListingFundamentals(orgId!, selectedPosition!.listing_id).then(
        (res) => res as { data: FundamentalsSnapshot | null }
      ),
  });

  const holdingLedgerQuery = useQuery({
    queryKey: ["holdingLedger", orgId, activePortfolioId, selectedPosition?.listing_id],
    enabled: isAuthed && Boolean(orgId && activePortfolioId && selectedPosition?.listing_id),
    queryFn: () =>
      fetchHoldingTransactions(orgId!, activePortfolioId!, selectedPosition!.listing_id).then(
        (res) => res as { data: HoldingTransaction[] }
      ),
  });

  const normalizedExchanges = useMemo(() => {
    return (exchangesQuery.data?.data ?? []).map((exchange) => ({
      ...exchange,
      id: Number(exchange.id),
    }));
  }, [exchangesQuery.data]);

  const chartData = useMemo(() => {
    const series = performanceQuery.data?.data ?? [];
    if (series.length === 0) {
      return { labels: [], datasets: [] };
    }
    const baseValue = series[0]?.total_value_base ?? 0;
    const computed = series.map((point) => {
      if (chartView === "pnl") {
        return point.total_value_base - baseValue;
      }
      if (chartView === "indexed") {
        return baseValue ? (point.total_value_base / baseValue) * 100 : 0;
      }
      return point.total_value_base;
    });
    const labels = series.map((point) => point.date);

    return {
      labels,
      datasets: [
        {
          label: chartView === "pnl" ? "PnL" : chartView === "indexed" ? "Indexed (100)" : "Portfolio Value",
          data: computed,
          borderColor: "rgba(255, 199, 102, 0.9)",
          backgroundColor: "rgba(255, 199, 102, 0.2)",
          tension: 0.35,
          fill: true,
          pointRadius: 0,
        },
      ],
    };
  }, [performanceQuery.data, chartView]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index" as const, intersect: false },
      plugins: {
        tooltip: {
          callbacks: {
            label: (context: { dataset: { label?: string }; parsed: { y?: number } }) => {
              const value = context.parsed.y ?? 0;
              if (chartView === "indexed") {
                return `Indexed: ${value.toFixed(1)}`;
              }
              return `${context.dataset.label}: ${formatMoney(value, chartView === "pnl" ? baseCurrency : baseCurrency)}`;
            },
          },
        },
      },
    };
  }, [chartView, baseCurrency]);

  const totalValue = allocationQuery.data?.data.total_value_base ?? 0;

  const allocationBuckets = useMemo(() => {
    const allocation = allocationQuery.data?.data;
    if (!allocation) {
      return [];
    }
    if (allocationView === "currency") {
      return allocation.by_currency.map((entry) => ({
        label: entry.currency,
        weight: entry.weight,
      }));
    }
    if (allocationView === "country") {
      return [];
    }
    return allocation.by_sector.map((entry) => ({
      label: entry.sector,
      weight: entry.weight,
    }));
  }, [allocationQuery.data, allocationView]);

  const topAllocationWeight = allocationBuckets[0]?.weight ?? 0;

  const strategyOverview = `## Systematisk investeringsstrategi

**Hard filters**
- Quality: EPS TTM > 0 and Operating Cash Flow TTM > 0
- Trend: Price > MA200 and MA50 > MA200

**Scores (0-100)**
- Q (Quality): ROIC percentile
- T (Trend): 0.5*(Price/MA200 - 1) + 0.3*(MA50/MA200 - 1) + 0.2*(Price/MA50 - 1)
- RS (Relative Strength): 0.6*RS 6m + 0.4*RS 12m percentile
- Ti (Timing): based on RSI(14) vs target for risk level
- V (Volatility): 100 - percentile rank of ATR(20)/Price

**Total score**
Weighted by risk level (interpolated between anchors). Recommended = eligible + top N score.
`;

  const recommendationItems = useMemo(() => {
    const items = recommendationsQuery.data?.data?.items;
    return Array.isArray(items) ? items : [];
  }, [recommendationsQuery.data]);

  const excludedHoldings = useMemo(() => {
    const rows = factorScoresQuery.data?.data;
    const normalized = Array.isArray(rows) ? (rows as FactorScore[]) : [];
    return normalized.filter((row) => !row.passed_quality_filter || !row.passed_trend_filter);
  }, [factorScoresQuery.data]);

  const listingChartData = useMemo(() => {
    const series = listingPricesQuery.data?.data ?? [];
    if (series.length === 0) {
      return { labels: [], datasets: [] };
    }
    const limited = downsampleSeries(series, 1500);
    const closes = limited.map((point) => point.close);
    const sma50 = computeSma(closes, 50);
    const sma200 = computeSma(closes, 200);

    return {
      labels: limited.map((point) => point.date),
      datasets: [
        {
          label: "Close",
          data: closes,
          borderColor: "rgba(255, 199, 102, 0.9)",
          backgroundColor: "rgba(255, 199, 102, 0.2)",
          tension: 0.3,
          fill: true,
          pointRadius: 0,
        },
        {
          label: "SMA50",
          data: sma50,
          borderColor: "rgba(89, 211, 255, 0.8)",
          tension: 0.3,
          pointRadius: 0,
          fill: false,
        },
        {
          label: "SMA200",
          data: sma200,
          borderColor: "rgba(255, 107, 107, 0.8)",
          tension: 0.3,
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }, [listingPricesQuery.data]);

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        setSelectedPosition(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  useEffect(() => {
    if (!seedOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSeedOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [seedOpen]);

  function openPositionDrawer(position: Position) {
    setSelectedPosition(position);
    setListingRange("90D");
    setListingBackfillError(null);
    setListingBackfillLoading(false);
    setLedgerDeleteTarget(null);
    setLedgerDeleteError(null);
    setLedgerDeleteLoading(false);
    setDrawerOpenedAt(Date.now());
    setSuppressBackdropClick(true);
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setDrawerOpenedAt(null);
    setSuppressBackdropClick(false);
    setSelectedPosition(null);
    setLedgerDeleteTarget(null);
    setLedgerDeleteError(null);
    setLedgerDeleteLoading(false);
  }

  function handleDrawerBackdropClick() {
    if (suppressBackdropClick) {
      setSuppressBackdropClick(false);
      return;
    }
    if (drawerOpenedAt && Date.now() - drawerOpenedAt < 200) {
      return;
    }
    closeDrawer();
  }

  function openSeedDrawer(position?: Position | null) {
    setSeedError(null);
    setSeedOpen(true);
    if (position) {
      setSeedListingId(String(position.listing_id));
      setSeedQuantity(position.quantity ? position.quantity.toString() : "");
      setSeedAvgCost(position.avg_cost_base ? position.avg_cost_base.toString() : "");
      setSeedCurrency(position.currency ?? baseCurrency);
      setSeedListingLocked(true);
    } else {
      setSeedListingId("");
      setSeedQuantity("");
      setSeedAvgCost("");
      setSeedCurrency(baseCurrency);
      setSeedListingLocked(false);
    }
    setSeedFirstBuyDate(todayString());
    setSeedNotes("");
  }

  function closeSeedDrawer() {
    setSeedOpen(false);
    setSeedError(null);
    setSeedListingLocked(false);
  }

  async function handleSeedSave() {
    if (!orgId || !activePortfolioId) {
      return;
    }
    setSeedError(null);
    const listingId = Number(seedListingId);
    const quantity = Number(seedQuantity.replace(",", "."));
    const avgCost = Number(seedAvgCost.replace(",", "."));
    if (!Number.isFinite(listingId) || listingId <= 0) {
      setSeedError("Listing id must be a valid number.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setSeedError("Quantity must be a positive number.");
      return;
    }
    if (!Number.isFinite(avgCost) || avgCost <= 0) {
      setSeedError("Average cost must be a positive number.");
      return;
    }
    if (!seedCurrency || seedCurrency.length < 3) {
      setSeedError("Cost currency is required.");
      return;
    }
    if (!seedFirstBuyDate || seedFirstBuyDate.length !== 10) {
      setSeedError("First buy date must be YYYY-MM-DD.");
      return;
    }
    try {
      setSeedSaving(true);
      await seedPosition(orgId, activePortfolioId, listingId, {
        quantity,
        avg_cost: avgCost,
        cost_currency: seedCurrency.toUpperCase(),
        first_buy_date: seedFirstBuyDate,
        notes: seedNotes ? seedNotes : null,
      });
      setSeedOpen(false);
      positionsQuery.refetch();
      summaryQuery.refetch();
    } catch (err) {
      setSeedError(err instanceof Error ? err.message : "Failed to seed position");
    } finally {
      setSeedSaving(false);
    }
  }

  function guessCurrency(result: { ticker: string; exchange?: string | null }) {
    const ticker = result.ticker.toUpperCase();
    const exchangeCode = result.exchange?.toUpperCase() ?? "";
    if (ticker.endsWith(".ST")) {
      return "SEK";
    }
    if (ticker.endsWith(".L")) {
      return "GBP";
    }
    if (ticker.endsWith(".DE")) {
      return "EUR";
    }
    if (ticker.endsWith(".SW")) {
      return "CHF";
    }
    if (ticker.endsWith(".TO")) {
      return "CAD";
    }
    if (exchangeCode === "NMS" || exchangeCode === "NYQ" || exchangeCode.includes("NASDAQ") || exchangeCode.includes("NYSE")) {
      return "USD";
    }
    return baseCurrency;
  }

  function guessExchangeId(result: { ticker: string; exchange?: string | null }) {
    const ticker = result.ticker.toUpperCase();
    const exchangeCode = result.exchange?.toUpperCase() ?? "";
    const matchByName = (name: string) =>
      normalizedExchanges.find((exchange) => exchange.name.toUpperCase().includes(name.toUpperCase())) ?? null;

    if (ticker.endsWith(".ST") || exchangeCode.includes("STO") || exchangeCode.includes("ST")) {
      return matchByName("Nasdaq Stockholm");
    }
    if (ticker.endsWith(".XD") || exchangeCode.includes("XETRA") || exchangeCode.includes("FRA")) {
      return matchByName("Xetra");
    }
    if (exchangeCode === "NMS" || exchangeCode.includes("NASDAQ")) {
      return matchByName("NASDAQ");
    }
    if (exchangeCode === "NYQ" || exchangeCode.includes("NYSE")) {
      return matchByName("NYSE");
    }
    if (exchangeCode.includes("BZX") || exchangeCode.includes("BATS")) {
      return matchByName("Cboe BZX");
    }
    return null;
  }

  function buildExchangePayload(result: { ticker: string; exchange?: string | null }) {
    const ticker = result.ticker.toUpperCase();
    const exchangeCode = result.exchange?.toUpperCase() ?? "";

    if (ticker.endsWith(".ST") || exchangeCode.includes("STO") || exchangeCode.includes("ST")) {
      return { name: "Nasdaq Stockholm", country: "SE", timezone: "Europe/Stockholm", mic_code: null };
    }
    if (ticker.endsWith(".XD") || exchangeCode.includes("XETRA") || exchangeCode.includes("FRA")) {
      return { name: "Xetra", country: "DE", timezone: "Europe/Berlin", mic_code: "XETR" };
    }
    if (exchangeCode === "NMS" || exchangeCode.includes("NASDAQ")) {
      return { name: "NASDAQ", country: "US", timezone: "America/New_York", mic_code: "XNAS" };
    }
    if (exchangeCode === "NYQ" || exchangeCode.includes("NYSE")) {
      return { name: "NYSE", country: "US", timezone: "America/New_York", mic_code: "XNYS" };
    }
    if (exchangeCode.includes("BZX") || exchangeCode.includes("BATS")) {
      return { name: "Cboe BZX", country: "US", timezone: "America/New_York", mic_code: "BATS" };
    }

    const fallbackName = result.exchange?.trim() || `Exchange ${ticker}`;
    return { name: fallbackName, country: "Unknown", timezone: "UTC", mic_code: null };
  }

  async function ensureExchange(result: { ticker: string; exchange?: string | null }) {
    const existing = guessExchangeId(result);
    if (existing) {
      return existing;
    }
    const payload = buildExchangePayload(result);
    const created = await apiFetch<{ data: { id: number | string; name: string; country: string; timezone: string } }>(
      `/orgs/${orgId}/exchanges`,
      {
        method: "POST",
        body: JSON.stringify(payload),
      }
    );
    const exchange = { ...created.data, id: Number(created.data.id) };
    exchangesQuery.refetch();
    return exchange;
  }

  async function handleCreateFromYahoo(result: { ticker: string; name?: string | null; exchange?: string | null }) {
    if (!orgId) {
      return;
    }
    setMarketSearchError(null);
    setMarketCreateStatus(null);

    let exchange;
    try {
      exchange = await ensureExchange(result);
    } catch (err) {
      setMarketSearchError(err instanceof Error ? err.message : "Failed to create exchange");
      return;
    }

    setMarketCreateSubmitting(true);
    try {
      const currency = guessCurrency(result);
      const created = await apiFetch<{ data: { instrument: { id: number | string; name?: string | null }; listing: { id: number | string; instrument_id: number | string; exchange_id: number | string; ticker: string; currency: string; active: boolean } } }>(
        `/orgs/${orgId}/instruments`,
        {
          method: "POST",
          body: JSON.stringify({
            name: result.name ?? result.ticker,
            asset_type: "Equity",
            sector: null,
            country: null,
            metadata: { source: "yahoo_search", exchange: result.exchange ?? null },
            listing: {
              exchange_id: exchange.id,
              ticker: result.ticker,
              currency,
              active: true,
            },
          }),
        }
      );

      const listing = created.data.listing as {
        id: number | string;
        instrument_id: number | string;
        exchange_id: number | string;
        ticker: string;
        currency: string;
        active: boolean;
      };
      const instrument = created.data.instrument as { id: number | string; name: string };
      const exchangeInfo = normalizedExchanges.find((item) => item.id === Number(listing.exchange_id));

      const listingSelection: ListingSearch = {
        id: Number(listing.id),
        ticker: listing.ticker,
        currency: listing.currency,
        active: listing.active,
        instrument_id: Number(listing.instrument_id),
        instrument_name: instrument?.name ?? result.name ?? listing.ticker,
        exchange_id: Number(listing.exchange_id),
        exchange_name: exchangeInfo?.name ?? "",
        exchange_mic: exchangeInfo?.mic_code ?? null,
      };

      setSelectedListing(listingSelection);
      setMarketSearchResult(`${listingSelection.ticker} · ${listingSelection.instrument_name}`);
      setMarketCreateStatus(`Created ${listingSelection.ticker} on ${listingSelection.exchange_name || "exchange"}.`);
    } catch (err) {
      setMarketSearchError(err instanceof Error ? err.message : "Create instrument failed");
    } finally {
      setMarketCreateSubmitting(false);
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setAuthError(null);
    try {
      await login(email, password);
      setAuthReady(true);
      meQuery.refetch();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed";
      if (/rate limit|locked/i.test(message)) {
        setAuthError(`${message} Please wait before trying again.`);
      } else {
        setAuthError(message);
      }
    }
  }

  async function handleCreatePortfolio() {
    if (!portfolioName || !orgId) {
      return;
    }
    await apiFetch(`/orgs/${orgId}/portfolios`, {
      method: "POST",
      body: JSON.stringify({ name: portfolioName, base_currency: "SEK" }),
    });
    setPortfolioName("");
    portfoliosQuery.refetch();
  }

  async function handleRunRecommendations() {
    if (!orgId || !activePortfolioId) {
      return;
    }
    setRecommendationError(null);
    setRecommendationRunning(true);
    try {
      const riskLevel = Number(recommendationRiskLevel) || 5;
      const topN = Number(recommendationTopN) || 3;
      await runRecommendations(orgId, activePortfolioId, { riskLevel, topN });
      recommendationsQuery.refetch();
      factorScoresQuery.refetch();
    } catch (err) {
      setRecommendationError(err instanceof Error ? err.message : "Failed to run recommendations");
    } finally {
      setRecommendationRunning(false);
    }
  }

  async function handleExplainRecommendation(listingId: number | string) {
    if (!orgId || !activePortfolioId) {
      return;
    }
    setRecommendationExplainError(null);
    setRecommendationExplainLoading(true);
    try {
      const result = await fetchRecommendationExplanation(orgId, {
        portfolioId: Number(activePortfolioId),
        listingId: Number(listingId),
        riskLevel: Number(recommendationRiskLevel) || 5,
        topN: Number(recommendationTopN) || 3,
      });
      setRecommendationExplainResult(result.data);
      setRecommendationExplainOpen(true);
    } catch (err) {
      setRecommendationExplainError(err instanceof Error ? err.message : "Failed to explain recommendation");
      setRecommendationExplainOpen(true);
    } finally {
      setRecommendationExplainLoading(false);
    }
  }

  async function handlePortfolioAnalysis() {
    if (!orgId || !activePortfolioId) {
      return;
    }
    setPortfolioAnalysisError(null);
    setPortfolioAnalysisLoading(true);
    try {
      const result = await fetchPortfolioAnalysis(orgId, activePortfolioId);
      setPortfolioAnalysis(result.data);
      setPortfolioAnalysisOpen(true);
    } catch (err) {
      setPortfolioAnalysisError(err instanceof Error ? err.message : "Failed to fetch portfolio analysis");
    } finally {
      setPortfolioAnalysisLoading(false);
    }
  }

  async function handleListingBackfill() {
    if (!orgId || !selectedPosition || !activePortfolioId) {
      return;
    }
    const availability = listingAvailabilityQuery.data?.data;
    setListingBackfillError(null);
    setListingBackfillLoading(true);
    try {
      const from = availability?.start_date
        ? shiftDate(availability.start_date, -365)
        : shiftDate(todayString(), -365);
      await backfillListingPrices(orgId, selectedPosition.listing_id, { from });
      listingPricesQuery.refetch();
      listingAvailabilityQuery.refetch();
    } catch (err) {
      setListingBackfillError(err instanceof Error ? err.message : "Failed to fetch history");
    } finally {
      setListingBackfillLoading(false);
    }
  }

  async function handleDeleteTransaction() {
    if (!orgId || !activePortfolioId || !ledgerDeleteTarget) {
      return;
    }
    setLedgerDeleteError(null);
    setLedgerDeleteLoading(true);
    try {
      await deleteTransaction(orgId, activePortfolioId, ledgerDeleteTarget.id);
      setLedgerDeleteTarget(null);
      holdingLedgerQuery.refetch();
      positionsQuery.refetch();
      allocationQuery.refetch();
      performanceQuery.refetch();
      summaryQuery.refetch();
    } catch (err) {
      setLedgerDeleteError(err instanceof Error ? err.message : "Failed to delete transaction");
    } finally {
      setLedgerDeleteLoading(false);
    }
  }

  async function handleMarkNotification(notificationId: number) {
    if (!orgId) {
      return;
    }
    await markNotificationRead(orgId, notificationId);
    notificationsQuery.refetch();
  }

  async function handleCreateTransaction() {
    if (!orgId || !activePortfolioId || !selectedListing) {
      setHoldingError("Select a portfolio and listing first.");
      return;
    }
    setHoldingError(null);
    setTransactionSuccess(null);
    try {
      setTransactionSubmitting(true);
      const qty = Number(transactionQty.replace(",", "."));
      const price = Number(transactionPrice.replace(",", "."));
      const fees = Number(transactionFees.replace(",", ".")) || 0;

      if (!transactionDate || transactionDate.length !== 10) {
        setHoldingError("Trade date must be YYYY-MM-DD.");
        return;
      }

      if (transactionType === "DIVIDEND" || transactionType === "FEE") {
        if (!Number.isFinite(price) || price <= 0) {
          setHoldingError("Amount must be a positive number.");
          return;
        }
      } else {
        if (!Number.isFinite(qty) || qty <= 0) {
          setHoldingError("Quantity must be a positive number.");
          return;
        }
        if (!Number.isFinite(price) || price <= 0) {
          setHoldingError("Price must be a positive number.");
          return;
        }
      }

      const payload = {
        listing_id: selectedListing.id,
        trade_date: transactionDate,
        type: transactionType,
        quantity: transactionType === "DIVIDEND" || transactionType === "FEE" ? 1 : qty,
        price,
        currency: selectedListing.currency,
        fees,
      };
      setTransactionDebug({ request: payload, response: null, error: null });
      const response = await createTransaction(orgId, activePortfolioId, payload);
      positionsQuery.refetch();
      allocationQuery.refetch();
      performanceQuery.refetch();
      setTransactionSuccess("Transaction added.");
      setTransactionDebug({ request: payload, response: response as Record<string, unknown>, error: null });

    } catch (err) {
      setHoldingError(err instanceof Error ? err.message : "Failed to create transaction");
      console.error("Transaction create failed", err);
      setTransactionDebug((prev) => ({
        request: prev.request,
        response: null,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    } finally {
      setTransactionSubmitting(false);
    }
  }


  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Haborn Invest & Consulting</p>
          <h1>Portfolio Command Deck</h1>
          <p className="subtitle">Monthly recommendations, allocation, and performance at a glance.</p>
        </div>
        <div className="hero-card">
          <h2>Session</h2>
          {isAuthed ? (
            <div className="badge">Authenticated</div>
          ) : authReady && meQuery.isLoading ? (
            <div className="badge">Checking session...</div>
          ) : (
            <form onSubmit={handleLogin} className="login-form">
              <label>
                Email
                <input value={email} onChange={(e) => setEmail(e.target.value)} />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {authError && <p className="error">{authError}</p>}
              <button type="submit">Sign in</button>
            </form>
          )}
        </div>
      </header>

      <section className="toolbar">
        <div>
          <span className="label">Organization</span>
          <select
            value={orgId ?? ""}
            onChange={(e) => setSelectedOrg(Number(e.target.value))}
            disabled={!isAuthed}
          >
            {orgs.map((org) => (
              <option key={org.org_id} value={org.org_id}>
                {org.name} ({org.role})
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Portfolio</span>
          <select
            value={activePortfolioId ?? ""}
            onChange={(e) => setSelectedPortfolio(Number(e.target.value))}
            disabled={!isAuthed}
          >
            {portfolios.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </select>
        </div>
        <div className="status-pill">
          <span className="label">Market data</span>
          <span className={healthQuery.data?.data.market_data === "ok" ? "pos" : "neg"}>
            {healthQuery.isLoading
              ? "Checking…"
              : healthQuery.data?.data.market_data === "ok"
              ? "Connected"
              : "Unavailable"}
          </span>
        </div>
        <div className="create-portfolio">
          <input
            placeholder="New portfolio name"
            value={portfolioName}
            onChange={(e) => setPortfolioName(e.target.value)}
            disabled={!isAuthed}
          />
          <button onClick={handleCreatePortfolio} disabled={!isAuthed}>
            Create
          </button>
        </div>
      </section>

      <section className="view-toggle">
        <div className="toggle-group">
          <button
            className={activeView === "dashboard" ? "toggle active" : "toggle"}
            onClick={() => setActiveView("dashboard")}
          >
            Command Deck
          </button>
          <button
            className={activeView === "regime" ? "toggle active" : "toggle"}
            onClick={() => setActiveView("regime")}
          >
            Regime Analysis
          </button>
        </div>
      </section>

      {activeView === "dashboard" ? (
        <section className="grid">
        <DashboardSection
          summaryLoading={summaryQuery.isLoading}
          summary={summaryQuery.data?.data}
          recommendationsCount={recommendationsQuery.data?.data?.items?.length ?? "—"}
          baseCurrency={baseCurrency}
          totalValue={totalValue}
          formatMoney={formatMoney}
          formatPercent={formatPercent}
          chartView={chartView}
          onChartViewChange={setChartView}
          chartRange={chartRange}
          onChartRangeChange={setChartRange}
          chartData={chartData}
          chartOptions={chartOptions}
          performanceLoading={performanceQuery.isLoading}
          performanceHasData={Boolean(performanceQuery.data?.data?.length)}
          onPortfolioAnalysis={handlePortfolioAnalysis}
          portfolioAnalysisLoading={portfolioAnalysisLoading}
          portfolioAnalysisError={portfolioAnalysisError}
          recommendationItems={recommendationItems}
          recommendationsLoading={recommendationsQuery.isLoading}
          formatScore={formatScore}
          onExplainRecommendation={handleExplainRecommendation}
          recommendationRiskLevel={recommendationRiskLevel}
          onRecommendationRiskLevelChange={setRecommendationRiskLevel}
          recommendationTopN={recommendationTopN}
          onRecommendationTopNChange={setRecommendationTopN}
          onRunRecommendations={handleRunRecommendations}
          recommendationRunning={recommendationRunning}
          recommendationError={recommendationError}
          recommendationsMeta={recommendationsQuery.data?.data ?? null}
          onViewStrategy={() => setStrategyOpen(true)}
        />
        <div className="card">
          <div className="card-header">
            <h3>Allocation</h3>
            {topAllocationWeight > 0.6 && (
              <span className="warning" title="Top allocation exceeds 60%">
                ⚠
              </span>
            )}
          </div>
          <div className="card-toggles">
            <div className="toggle-group">
              {[
                { label: "Sector", value: "sector" },
                { label: "Currency", value: "currency" },
                { label: "Country", value: "country" },
              ].map((option) => (
                <button
                  key={option.value}
                  className={allocationView === option.value ? "toggle active" : "toggle"}
                  onClick={() => setAllocationView(option.value as "sector" | "currency" | "country")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="allocation">
            {allocationQuery.isLoading && <div className="empty">Loading allocation…</div>}
            {allocationBuckets.slice(0, 6).map((bucket) => (
              <div key={bucket.label} className="allocation-row">
                <div>
                  <span>{bucket.label}</span>
                  <span className="muted">{formatPercent(bucket.weight)}</span>
                </div>
                <div className="allocation-bar">
                  <div className="allocation-fill" style={{ width: `${bucket.weight * 100}%` }} />
                </div>
              </div>
            ))}
            {allocationView === "country" && !allocationBuckets.length && !allocationQuery.isLoading && (
              <div className="empty">No country data yet</div>
            )}
            {!allocationBuckets.length && allocationView !== "country" && !allocationQuery.isLoading && (
              <div className="empty">No allocation data</div>
            )}
          </div>
        </div>

        <div className="card span-2">
          <h3>Positions</h3>
          <div className="card-actions">
            <button className="ghost" onClick={() => openSeedDrawer()}>
              Add holding
            </button>
          </div>
          <div className="table">
            <div className="table-header">
              <span>Ticker</span>
              <span>Qty</span>
              <span>Last Close</span>
              <span>Day</span>
              <span>Total PnL</span>
              <span>Action</span>
            </div>
            {positionsQuery.isLoading && <div className="empty">Loading positions…</div>}
            {(positionsQuery.data?.data ?? []).map((pos) => (
              <div
                key={pos.listing_id}
                className="table-row clickable"
                onMouseDown={() => openPositionDrawer(pos)}
              >
                <span>{pos.ticker ?? "—"}</span>
                <span>{pos.quantity.toFixed(2)}</span>
                <span>{formatMoney(pos.price_close, pos.currency ?? baseCurrency)}</span>
                <span className={Number(pos.day_change_base) >= 0 ? "pos" : "neg"}>
                  {formatMoney(pos.day_change_base, baseCurrency)}
                </span>
                <span className={Number(pos.total_pnl_base) >= 0 ? "pos" : "neg"}>
                  {formatMoney(pos.total_pnl_base, "$" )}
                </span>
                <button
                  className="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    openSeedDrawer(pos);
                  }}
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Notifications</h3>
          <div className="signals">
            {notificationsQuery.isLoading && <div className="empty">Loading notifications…</div>}
            {(notificationsQuery.data?.data ?? []).map((note) => (
              <div key={note.id} className="signal-row">
                <div>
                  <strong>{note.status}</strong>
                  <span>{note.channel}</span>
                </div>
                <button className="ghost" onClick={() => handleMarkNotification(note.id)}>
                  Mark read
                </button>
              </div>
            ))}
            {(!notificationsQuery.data?.data?.length && !notificationsQuery.isLoading && (
              <div className="empty">No notifications</div>
            )) || null}
          </div>
        </div>

        <div className="card span-2">
          <h3>News</h3>
          <div className="signals">
            {newsQuery.isLoading && <div className="empty">Loading news…</div>}
            {(newsQuery.data?.data ?? []).map((news) => (
              <a key={news.id} className="news-row" href={news.url} target="_blank" rel="noreferrer">
                <div>
                  <strong>{news.title}</strong>
                  <span>{news.source}{formatNewsMatch(news.match_bases)}</span>
                </div>
                <span>{news.published_at.slice(0, 10)}</span>
              </a>
            ))}
            {(!newsQuery.data?.data?.length && !newsQuery.isLoading && (
              <div className="empty">No news</div>
            )) || null}
          </div>
        </div>

        <div className="card span-2">
          <div className="card-header">
            <h3>Add Holding</h3>
            <span className="muted">Search Yahoo and add transactions</span>
          </div>
          <div className="strategy-grid">
            <div className="strategy-form">
              <div className="strategy-card">
                <strong>Yahoo Search</strong>
                <label>
                  Query
                  <input
                    value={marketSearchTerm}
                    onChange={(e) => {
                      setMarketSearchTerm(e.target.value);
                      setMarketSearchResult(null);
                      setMarketSearchError(null);
                    }}
                  />
                </label>
                <div className="muted">
                  {marketSearchTerm.length < 2 && "Type at least 2 characters to search."}
                  {marketSearchTerm.length >= 2 && marketSearchQuery.isLoading && "Searching Yahoo…"}
                  {marketSearchTerm.length >= 2 &&
                    marketSearchQuery.isFetched &&
                    !marketSearchQuery.isLoading &&
                    (marketSearchQuery.data?.data ?? []).length === 0 &&
                    "No Yahoo matches found."}
                </div>
                {marketSearchQuery.isLoading && <p className="muted">Searching Yahoo…</p>}
                {marketSearchQuery.isError && (
                  <p className="error">
                    {marketSearchQuery.error instanceof Error
                      ? marketSearchQuery.error.message
                      : "Yahoo search failed"}
                  </p>
                )}
                {(marketSearchQuery.data?.data ?? []).map((result) => (
                  <button
                    key={`${result.ticker}-${result.exchange ?? ""}`}
                    className="ghost"
                    onClick={() => handleCreateFromYahoo(result)}
                    disabled={!isAuthed || marketCreateSubmitting}
                  >
                    {result.ticker} {result.exchange ? `· ${result.exchange}` : ""}
                  </button>
                ))}
                {marketSearchResult && <p className="muted">Selected: {marketSearchResult}</p>}
                {marketCreateStatus && <p className="muted">{marketCreateStatus}</p>}
                {marketSearchError && <p className="error">{marketSearchError}</p>}
                {!isAuthed && (marketSearchResult || marketCreateStatus) && (
                  <p className="muted">Sign in to create a listing from Yahoo.</p>
                )}
              </div>
              <label>
                Selected listing
                <input value={selectedListing?.ticker ?? ""} readOnly />
              </label>
              <label>
                Trade date
                <input value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} />
              </label>
              <label>
                Type
                <select value={transactionType} onChange={(e) => setTransactionType(e.target.value)}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                  <option value="DIVIDEND">DIVIDEND</option>
                  <option value="FEE">FEE</option>
                </select>
              </label>
              <label>
                Quantity
                <input value={transactionQty} onChange={(e) => setTransactionQty(e.target.value)} />
              </label>
              <label>
                Price
                <input
                  value={transactionPrice}
                  onChange={(e) => setTransactionPrice(e.target.value)}
                  placeholder={transactionType === "DIVIDEND" || transactionType === "FEE" ? "Amount" : "Price"}
                />
              </label>
              <label>
                Fees
                <input value={transactionFees} onChange={(e) => setTransactionFees(e.target.value)} />
              </label>
              {holdingError && <p className="error">{holdingError}</p>}
              {transactionSuccess && <p className="muted">{transactionSuccess}</p>}
              <button onClick={handleCreateTransaction} disabled={!isAuthed || transactionSubmitting}>
                Add Transaction
              </button>
            </div>
          </div>
        </div>
        </section>
      ) : (
        <section className="regime-section">
          <RegimeDashboard orgId={orgId ?? null} disabled={!isAuthed} />
        </section>
      )}

      {portfolioAnalysisOpen && portfolioAnalysis && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>AI Portfolio Review</h3>
              <button className="ghost" onClick={() => setPortfolioAnalysisOpen(false)}>
                Close
              </button>
            </div>
            <ReactMarkdown>{portfolioAnalysis.response_text}</ReactMarkdown>
          </div>
        </div>
      )}

      {recommendationExplainOpen && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Recommendation Explanation</h3>
              <button
                className="ghost"
                onClick={() => {
                  setRecommendationExplainOpen(false);
                  setRecommendationExplainResult(null);
                  setRecommendationExplainError(null);
                }}
              >
                Close
              </button>
            </div>
            {recommendationExplainLoading && <div className="empty">Loading explanation…</div>}
            {recommendationExplainError && <p className="error">{recommendationExplainError}</p>}
            {recommendationExplainResult && (
              <ReactMarkdown>{recommendationExplainResult.response_text}</ReactMarkdown>
            )}
          </div>
        </div>
      )}

      {strategyOpen && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Strategy Overview</h3>
              <button className="ghost" onClick={() => setStrategyOpen(false)}>
                Close
              </button>
            </div>
            <ReactMarkdown>{strategyOverview}</ReactMarkdown>
          </div>
        </div>
      )}

      {drawerOpen && selectedPosition && (
        <div className="drawer-backdrop" onClick={handleDrawerBackdropClick}>
          <div className="drawer" onClick={(event) => event.stopPropagation()}>
            <div className="drawer-header">
              <div>
                <h3>
                  {selectedPosition.instrument_name ?? "Position"}{" "}
                  <span className="muted">{selectedPosition.ticker ?? ""}</span>
                </h3>
                <span className="muted">Last updated {selectedPosition.price_date ?? "—"}</span>
              </div>
              <button className="ghost" onClick={closeDrawer}>
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
                      className={listingRange === range ? "chip active" : "chip"}
                      onClick={() => setListingRange(range as "90D" | "YTD" | "ALL")}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>
              <div className="range-actions">
                <span className="muted">
                  {listingAvailabilityQuery.data?.data?.start_date
                    ? `First buy ${listingAvailabilityQuery.data.data.start_date}`
                    : "First buy date not found"}
                  {listingAvailabilityQuery.data?.data?.earliest_price_date
                    ? ` · Available ${listingAvailabilityQuery.data.data.earliest_price_date} → ${listingAvailabilityQuery.data.data.latest_price_date ?? "—"}`
                    : ""}
                </span>
                <button className="ghost" onClick={handleListingBackfill} disabled={listingBackfillLoading}>
                  {listingBackfillLoading ? "Fetching…" : "Fetch history (1Y pre-buy)"}
                </button>
                {listingBackfillError && <span className="error">{listingBackfillError}</span>}
              </div>
              {listingAvailabilityQuery.data?.data?.missing_from_start && (
                <div className="notice">
                  <span>
                    Price history available from {listingAvailabilityQuery.data.data.earliest_price_date ?? "—"}. First buy was {listingAvailabilityQuery.data.data.start_date}.
                  </span>
                  <button
                    className="ghost"
                    onClick={handleListingBackfill}
                    disabled={listingBackfillLoading}
                  >
                    {listingBackfillLoading ? "Fetching…" : "Fetch history"}
                  </button>
                  {listingBackfillError && <span className="error">{listingBackfillError}</span>}
                </div>
              )}
              {!listingPricesQuery.isLoading && listingChartData.labels?.length === 0 && listingAvailabilityQuery.data?.data?.latest_price_date && (
                <div className="notice">
                  <span>
                    No prices in this range. Available {listingAvailabilityQuery.data.data.earliest_price_date ?? "—"} → {listingAvailabilityQuery.data.data.latest_price_date ?? "—"}.
                  </span>
                  <button className="ghost" onClick={() => setListingRange("ALL")}>View ALL</button>
                </div>
              )}
              {listingPricesQuery.isLoading ? (
                <div className="empty">Loading price history…</div>
              ) : listingChartData.labels?.length ? (
                <div className="chart-wrap small">
                  <Line data={listingChartData} options={{ responsive: true, maintainAspectRatio: false }} />
                </div>
              ) : (
                <div className="empty">No price data yet</div>
              )}
            </div>
            <div className="drawer-section">
              <h4>Activity</h4>
              {holdingLedgerQuery.isLoading ? (
                <div className="empty">Loading activity…</div>
              ) : (holdingLedgerQuery.data?.data ?? []).length ? (
                <div className="table ledger-table">
                  <div className="table-header">
                    <span>Date</span>
                    <span>Type</span>
                    <span>Qty</span>
                    <span>Price</span>
                    <span>Run Qty</span>
                    <span></span>
                  </div>
                  {(holdingLedgerQuery.data?.data ?? []).map((row) => (
                    <div key={row.id} className="table-row">
                      <span>{row.trade_date.slice(0, 10)}</span>
                      <span>{row.type}</span>
                      <span>{row.quantity}</span>
                      <span>{row.price === null ? "—" : formatMoney(row.price, row.currency)}</span>
                      <span>{row.running_quantity}</span>
                      <button
                        type="button"
                        className="ghost danger compact"
                        onClick={() => {
                          setLedgerDeleteError(null);
                          setLedgerDeleteTarget(row);
                        }}
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
              {listingFundamentalsQuery.isLoading ? (
                <div className="empty">Loading fundamentals…</div>
              ) : listingFundamentalsQuery.data?.data ? (
                <div className="fundamentals-grid">
                  <div>
                    <span className="muted">As of</span>
                    <strong>{listingFundamentalsQuery.data.data.as_of_date?.slice(0, 10)}</strong>
                  </div>
                  <div>
                    <span className="muted">EPS TTM</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.eps_ttm)}</strong>
                  </div>
                  <div>
                    <span className="muted">Revenue TTM</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.revenue_ttm)}</strong>
                  </div>
                  <div>
                    <span className="muted">EBITDA TTM</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.ebitda_ttm)}</strong>
                  </div>
                  <div>
                    <span className="muted">Net income TTM</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.net_income_ttm)}</strong>
                  </div>
                  <div>
                    <span className="muted">Income tax TTM</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.income_tax_expense_ttm)}</strong>
                  </div>
                  <div>
                    <span className="muted">Operating CF TTM</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.operating_cashflow_ttm)}</strong>
                  </div>
                  <div>
                    <span className="muted">Capex TTM</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.capital_expenditure_ttm)}</strong>
                  </div>
                  <div>
                    <span className="muted">EBIT TTM</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.ebit_ttm)}</strong>
                  </div>
                  <div>
                    <span className="muted">Tax rate</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.tax_rate)}</strong>
                  </div>
                  <div>
                    <span className="muted">Total debt</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.total_debt)}</strong>
                  </div>
                  <div>
                    <span className="muted">Total equity</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.total_equity)}</strong>
                  </div>
                  <div>
                    <span className="muted">Cash & equivalents</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.cash_and_equivalents)}</strong>
                  </div>
                  <div>
                    <span className="muted">Shares outstanding</span>
                    <strong>{formatMetric(listingFundamentalsQuery.data.data.shares_outstanding)}</strong>
                  </div>
                  <div>
                    <span className="muted">Source</span>
                    <strong>{listingFundamentalsQuery.data.data.source}</strong>
                  </div>
                  <details className="fundamentals-raw">
                    <summary>Raw fundamentals (Yahoo)</summary>
                    <pre>{JSON.stringify(listingFundamentalsQuery.data.data.raw ?? {}, null, 2)}</pre>
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
      )}

      {ledgerDeleteTarget && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-header">
              <h3>Delete this transaction?</h3>
              <button className="ghost" onClick={() => setLedgerDeleteTarget(null)}>
                Close
              </button>
            </div>
            <p>
              {ledgerDeleteTarget.type} · {ledgerDeleteTarget.trade_date.slice(0, 10)} · {ledgerDeleteTarget.quantity}
              {ledgerDeleteTarget.price === null
                ? ""
                : ` @ ${formatMoney(ledgerDeleteTarget.price, ledgerDeleteTarget.currency)}`}
            </p>
            {ledgerDeleteError && <p className="error">{ledgerDeleteError}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setLedgerDeleteTarget(null)}
                disabled={ledgerDeleteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                onClick={handleDeleteTransaction}
                disabled={ledgerDeleteLoading}
              >
                {ledgerDeleteLoading ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {seedOpen && (
        <div className="modal" onClick={closeSeedDrawer}>
          <div className="modal-content" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{seedListingId ? "Edit Position" : "Seed Position"}</h3>
              <button className="ghost" onClick={closeSeedDrawer}>
                Close
              </button>
            </div>
            <div className="strategy-form">
              <label>
                Listing ID
                <input
                  value={seedListingId}
                  onChange={(event) => setSeedListingId(event.target.value)}
                  disabled={seedListingLocked}
                />
              </label>
              <label>
                Quantity
                <input value={seedQuantity} onChange={(event) => setSeedQuantity(event.target.value)} />
              </label>
              <label>
                Average cost (GAV)
                <input value={seedAvgCost} onChange={(event) => setSeedAvgCost(event.target.value)} />
              </label>
              <label>
                Cost currency
                <input value={seedCurrency} onChange={(event) => setSeedCurrency(event.target.value)} />
              </label>
              <label>
                First buy date
                <input
                  value={seedFirstBuyDate}
                  onChange={(event) => setSeedFirstBuyDate(event.target.value)}
                />
              </label>
              <label>
                Notes
                <textarea
                  rows={3}
                  value={seedNotes}
                  onChange={(event) => setSeedNotes(event.target.value)}
                />
              </label>
              {seedError && <p className="error">{seedError}</p>}
              <button onClick={handleSeedSave} disabled={seedSaving}>
                {seedSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
