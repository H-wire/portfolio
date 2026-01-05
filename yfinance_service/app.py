from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional
import math
import json
import urllib.request
from functools import lru_cache

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import yfinance as yf
import pandas as pd

app = FastAPI(debug=True)


class PricesRequest(BaseModel):
    tickers: List[str]
    start: str
    end: str


class InstrumentInfoRequest(BaseModel):
    ticker: str


class FxRatesRequest(BaseModel):
    pairs: List[str]
    date: str


class SearchRequest(BaseModel):
    query: str


class NewsRequest(BaseModel):
    tickers: List[str]
    limit: int | None = 10


class FundamentalsRequest(BaseModel):
    ticker: str


class CorporateActionsRequest(BaseModel):
    ticker: str


class RegimeAnalysisRequest(BaseModel):
    index_ticker: str = "^GSPC"
    vix_ticker: str = "^VIX"
    start_date: str = (datetime.now() - timedelta(days=730)).strftime("%Y-%m-%d") # Default 2 years back
    ma_short: int = 50
    ma_long: int = 200
    rsi_period: int = 14
    rsi_threshold: int = 50
    vix_threshold_bull: int = 20
    vix_threshold_bear: int = 25
    component_tickers: Optional[List[str]] = None


class ScorecardItem(BaseModel):
    factor: str
    value: str
    status: str


class ChartData(BaseModel):
    dates: List[str]
    close: List[Optional[float]]
    ma50: Optional[List[Optional[float]]] = None
    ma200: Optional[List[Optional[float]]] = None
    rsi: Optional[List[Optional[float]]] = None
    vix: Optional[List[Optional[float]]] = None


class RegimeAnalysisCharts(BaseModel):
    price_history: ChartData
    rsi_history: ChartData
    vix_history: ChartData


class RegimeAnalysisResponse(BaseModel):
    regime: str
    total_score: int
    scorecard: List[ScorecardItem]
    charts: RegimeAnalysisCharts


def _parse_date(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date: {value}") from exc


def _format_date(value: datetime) -> str:
    return value.strftime("%Y-%m-%d")


def _extract_raw(value):
    if value is None:
        return None
    if isinstance(value, dict):
        raw_value = value.get("raw")
        if raw_value is None:
            return None
        try:
            numeric = float(raw_value)
        except Exception:
            return None
        if numeric != numeric:
            return None
        return numeric
    if isinstance(value, (int, float)):
        numeric = float(value)
        if numeric != numeric:
            return None
        return numeric
    return None


def _clean_json(value):
    if isinstance(value, float):
        if not math.isfinite(value):
            return None
        return value
    if isinstance(value, dict):
        return {key: _clean_json(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_clean_json(item) for item in value]
    return value


def _sort_quote_rows(rows: List[dict]) -> List[dict]:
    def key_fn(row):
        end_date = row.get("endDate")
        raw = end_date.get("raw") if isinstance(end_date, dict) else end_date
        try:
            return datetime.strptime(str(raw)[:10], "%Y-%m-%d")
        except Exception:
            return datetime.min

    return sorted(rows, key=key_fn, reverse=True)


def _ttm_from_rows(rows: List[dict], key: str) -> Optional[float]:
    if not rows:
        return None
    total = 0.0
    count = 0
    for row in _sort_quote_rows(rows)[:4]:
        value = _extract_raw(row.get(key))
        if value is None:
            continue
        total += value
        count += 1
    return total if count > 0 else None


def _latest_from_rows(rows: List[dict], key: str) -> Optional[float]:
    if not rows:
        return None
    for row in _sort_quote_rows(rows)[:1]:
        value = _extract_raw(row.get(key))
        if value is not None:
            return value
    return None


def calculate_ma(series: pd.Series, window: int) -> pd.Series:
    """Calculate Moving Average"""
    return series.rolling(window=window).mean()

def calculate_rsi(series: pd.Series, window: int) -> pd.Series:
    """Calculate Relative Strength Index (RSI)"""
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).fillna(0)
    loss = (-delta.where(delta < 0, 0)).fillna(0)
    
    avg_gain = gain.ewm(com=window - 1, adjust=False).mean()
    avg_loss = loss.ewm(com=window - 1, adjust=False).mean()
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return rsi

def get_regime_status(value: float, bull_threshold: float, bear_threshold: float) -> str:
    if value >= bull_threshold:
        return "Bull"
    if value <= bear_threshold:
        return "Bear"
    return "Neutral"


def _cache_bucket(minutes: int = 30) -> int:
    return int(datetime.now(timezone.utc).timestamp() // (minutes * 60))


@lru_cache(maxsize=64)
def _download_history(ticker: str, start: str, end: str, interval: str, bucket: int):
    return yf.download(
        ticker,
        start=start,
        end=end,
        interval=interval,
        auto_adjust=False,
        progress=False,
    )


def _safe_history(ticker: str, start: str, end: str) -> pd.DataFrame:
    try:
        data = _download_history(ticker, start, end, "1d", _cache_bucket())
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch data for {ticker}: {exc}") from exc
    if data is None or data.empty:
        raise HTTPException(status_code=400, detail=f"No data for ticker {ticker}")
    return data


def _index_dates(index: pd.Index) -> List[str]:
    dates: List[str] = []
    for item in index:
        try:
            date_value = pd.to_datetime(item)
            dates.append(date_value.strftime("%Y-%m-%d"))
        except Exception:
            dates.append(str(item)[:10])
    return dates


def _series_to_list(series: pd.Series) -> List[Optional[float]]:
    values: List[Optional[float]] = []
    for value in series.tolist():
        if value is None or (isinstance(value, float) and not math.isfinite(value)):
            values.append(None)
        elif value != value:
            values.append(None)
        else:
            values.append(float(value))
    return values


def _latest_value(series: pd.Series) -> Optional[float]:
    if series is None:
        return None
    cleaned = series.dropna()
    if cleaned.empty:
        return None
    value = cleaned.iloc[-1]
    if value is None or value != value:
        return None
    return float(value)


def _status_from_flags(bull: bool, bear: bool) -> str:
    if bull:
        return "Bull"
    if bear:
        return "Bear"
    return "Neutral"


def _score_from_status(status: str) -> int:
    if status == "Bull":
        return 1
    if status == "Bear":
        return -1
    return 0


@lru_cache(maxsize=128)
def _fetch_quote_summary(ticker: str):
    base_url = "https://query2.finance.yahoo.com/v10/finance/quoteSummary"
    modules = ",".join(
        [
            "incomeStatementHistoryQuarterly",
            "cashflowStatementHistoryQuarterly",
            "balanceSheetHistoryQuarterly",
            "defaultKeyStatistics",
            "financialData",
        ]
    )
    url = f"{base_url}/{ticker}?modules={modules}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            return payload
    except Exception:
        return None

@lru_cache(maxsize=128)
def _get_ticker_data_cached(ticker: str, start_date: str, end_date: str) -> pd.DataFrame | None:
    try:
        data = yf.download(
            ticker,
            start=start_date,
            end=end_date,
            auto_adjust=False,
            progress=False,
        )
        if data.empty:
            return None
        return data
    except Exception:
        return None

@lru_cache(maxsize=128)
def _get_vix_data_cached(vix_ticker: str, start_date: str, end_date: str) -> pd.DataFrame | None:
    # VIX data often needs special handling or might be available under specific tickers
    # For now, treat it like any other ticker, but keep in mind potential future adjustments.
    return _get_ticker_data_cached(vix_ticker, start_date, end_date)


@lru_cache(maxsize=128)
def _get_vix_data_cached(vix_ticker: str, start_date: str, end_date: str) -> pd.DataFrame | None:
    # VIX data often needs special handling or might be available under specific tickers
    # For now, treat it like any other ticker, but keep in mind potential future adjustments.
    return _get_ticker_data_cached(vix_ticker, start_date, end_date)


async def perform_regime_analysis(request: RegimeAnalysisRequest) -> RegimeAnalysisResponse:
    # Parse dates
    start_date_dt = _parse_date(request.start_date)
    end_date_dt = datetime.now() # analyze up to today

    # --- 1. Fetch Index Data ---
    index_data = _get_ticker_data_cached(request.index_ticker, request.start_date, _format_date(end_date_dt))
    if index_data is None or index_data.empty:
        raise HTTPException(status_code=404, detail=f"Could not retrieve data for index ticker: {request.index_ticker}")
    
    index_data.index = pd.to_datetime(index_data.index)
    index_data = index_data.sort_index()

    # --- 2. Calculate Indicators for Index ---
    index_data['MA_Short'] = calculate_ma(index_data['Close'], request.ma_short)
    index_data['MA_Long'] = calculate_ma(index_data['Close'], request.ma_long)
    index_data['RSI'] = calculate_rsi(index_data['Close'], request.rsi_period)

    latest_close = index_data['Close'].iloc[-1]
    latest_ma_short = index_data['MA_Short'].iloc[-1]
    latest_ma_long = index_data['MA_Long'].iloc[-1]
    latest_rsi = index_data['RSI'].iloc[-1]

    scorecard_items: List[ScorecardItem] = []
    total_score = 0

    # --- 3. Evaluate Factors ---

    # 3.1 Index Close vs MA200
    price_vs_ma200_status = "N/A"
    if not pd.isna(latest_close) and not pd.isna(latest_ma_long):
        price_vs_ma200_status = get_regime_status(latest_close, latest_ma_long, latest_ma_long)
        if price_vs_ma200_status == "Bull": total_score += 1
        elif price_vs_ma200_status == "Bear": total_score -= 1
    scorecard_items.append(ScorecardItem(
        factor="Price vs MA_Long",
        value=f"{latest_close:.2f} vs {latest_ma_long:.2f}",
        status=price_vs_ma200_status
    ))

    # 3.2 MA50 vs MA200
    ma_cross_status = "N/A"
    if not pd.isna(latest_ma_short) and not pd.isna(latest_ma_long):
        ma_cross_status = get_regime_status(latest_ma_short, latest_ma_long, latest_ma_long)
        if ma_cross_status == "Bull": total_score += 1
        elif ma_cross_status == "Bear": total_score -= 1
    scorecard_items.append(ScorecardItem(
        factor="MA_Short vs MA_Long",
        value=f"{latest_ma_short:.2f} vs {latest_ma_long:.2f}",
        status=ma_cross_status
    ))

    # 3.3 RSI(14) on Index
    rsi_status = "N/A"
    if not pd.isna(latest_rsi):
        rsi_status = get_regime_status(latest_rsi, float(request.rsi_threshold), float(request.rsi_threshold)) # RSI is simpler, just compare to one threshold
        if rsi_status == "Bull": total_score += 1
        elif rsi_status == "Bear": total_score -= 1
    scorecard_items.append(ScorecardItem(
        factor=f"RSI({request.rsi_period})",
        value=f"{latest_rsi:.2f}",
        status=rsi_status
    ))
    
    # 3.4 VIX
    vix_status = "N/A"
    vix_value = None
    vix_history_chart_data = ChartData(dates=[], close=[])

    if request.vix_ticker:
        vix_data = _get_vix_data_cached(request.vix_ticker, request.start_date, _format_date(end_date_dt))
        if vix_data is not None and not vix_data.empty:
            vix_data.index = pd.to_datetime(vix_data.index)
            vix_data = vix_data.sort_index()
            vix_value = vix_data['Close'].iloc[-1]
            if not pd.isna(vix_value):
                # VIX is inverse: low VIX is bullish, high VIX is bearish
                if vix_value <= request.vix_threshold_bull:
                    vix_status = "Bull"
                    total_score += 1
                elif vix_value >= request.vix_threshold_bear:
                    vix_status = "Bear"
                    total_score -= 1
                else:
                    vix_status = "Neutral"
            
            # Prepare VIX chart data
            vix_history_chart_data = ChartData(
                dates=[_format_date(d) for d in vix_data.index.tolist()],
                close=vix_data['Close'].tolist()
            )
        
    scorecard_items.append(ScorecardItem(
        factor="VIX",
        value=f"{vix_value:.2f}" if vix_value is not None else "N/A",
        status=vix_status
    ))

    # 3.5 Market Breadth
    breadth_status = "N/A"
    breadth_percent = None
    if request.component_tickers:
        over_ma200_count = 0
        total_components = len(request.component_tickers)
        for component_ticker in request.component_tickers:
            comp_data = _get_ticker_data_cached(component_ticker, request.start_date, _format_date(end_date_dt))
            if comp_data is not None and not comp_data.empty:
                comp_data.index = pd.to_datetime(comp_data.index)
                comp_data = comp_data.sort_index()
                comp_data['MA200'] = calculate_ma(comp_data['Close'], 200)
                
                latest_comp_close = comp_data['Close'].iloc[-1]
                latest_comp_ma200 = comp_data['MA200'].iloc[-1]

                if not pd.isna(latest_comp_close) and not pd.isna(latest_comp_ma200) and latest_comp_close > latest_comp_ma200:
                    over_ma200_count += 1
        
        if total_components > 0:
            breadth_percent = (over_ma200_count / total_components) * 100
            # Define simple thresholds for breadth
            if breadth_percent >= 60: # Arbitrary: >60% over MA200 is bullish
                breadth_status = "Bull"
                total_score += 1
            elif breadth_percent <= 40: # Arbitrary: <40% over MA200 is bearish
                breadth_status = "Bear"
                total_score -= 1
            else:
                breadth_status = "Neutral"

    scorecard_items.append(ScorecardItem(
        factor="Market Breadth",
        value=f"{breadth_percent:.2f}%" if breadth_percent is not None else "N/A",
        status=breadth_status
    ))


    # --- 4. Determine Overall Regime ---
    regime = "Neutral"
    if total_score >= 2:
        regime = "Bull"
    elif total_score <= -2:
        regime = "Bear"

    # --- 5. Prepare Chart Data ---
    price_history_chart_data = ChartData(
        dates=[_format_date(d) for d in index_data.index.tolist()],
        close=index_data['Close'].tolist(),
        ma50=index_data['MA_Short'].tolist(),
        ma200=index_data['MA_Long'].tolist()
    )
    rsi_history_chart_data = ChartData(
        dates=[_format_date(d) for d in index_data.index.tolist()],
        close=index_data['Close'].tolist(), # Although not used directly, required by ChartData model
        rsi=index_data['RSI'].tolist()
    )

    charts = RegimeAnalysisCharts(
        price_history=price_history_chart_data,
        rsi_history=rsi_history_chart_data,
        vix_history=vix_history_chart_data # This could be empty if no VIX ticker
    )

    return RegimeAnalysisResponse(
        regime=regime,
        total_score=total_score,
        scorecard=scorecard_items,
        charts=charts
    )

def _normalize_prices(ticker: str, df) -> List[dict]:
    if df is None or df.empty:
        return []

    df = df.reset_index()
    rows: List[dict] = []
    for _, row in df.iterrows():
        date_value = row["Date"]
        # Handle both Timestamp and string dates
        if hasattr(date_value, 'strftime'):
            date_str = date_value.strftime("%Y-%m-%d")
        elif isinstance(date_value, pd.Timestamp):
            date_str = date_value.strftime("%Y-%m-%d")
        else:
            date_str = str(date_value)[:10]  # Take first 10 chars (YYYY-MM-DD)
            
        adj_value = row.get("Adj Close") if hasattr(row, "get") else None
        if adj_value is None:
            adj_close = None
        else:
            adj_close = float(adj_value) if adj_value == adj_value else None
        rows.append(
            {
                "ticker": ticker,
                "date": date_str,
                "open": float(row["Open"]) if row["Open"] == row["Open"] else None,
                "high": float(row["High"]) if row["High"] == row["High"] else None,
                "low": float(row["Low"]) if row["Low"] == row["Low"] else None,
                "close": float(row["Close"]) if row["Close"] == row["Close"] else None,
                "adj_close": adj_close,
                "volume": int(row["Volume"]) if row["Volume"] == row["Volume"] else None,
            }
        )
    return rows


def _try_ticker_candidates(query: str) -> List[dict]:
    candidates = []
    base = query.strip().upper().replace(" ", "")
    if base:
        candidates.append(base)
        if "." not in base:
            candidates.append(f"{base}.ST")

    results: List[dict] = []
    seen = set()
    for ticker in candidates:
        if ticker in seen:
            continue
        seen.add(ticker)
        try:
            # yfinance 1.0 manages its own curl_cffi session
            history = yf.Ticker(ticker).history(period="5d", interval="1d")
        except Exception:
            continue
        if history is None or history.empty:
            continue
        name = None
        try:
            info = yf.Ticker(ticker).fast_info
            name = info.get("shortName") or info.get("longName")
        except Exception:
            pass
        results.append({"ticker": ticker, "name": name, "exchange": None})
    return results


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/regime-analysis", response_model=RegimeAnalysisResponse)
async def regime_analysis(request: RegimeAnalysisRequest):
    try:
        response = await perform_regime_analysis(request)
        return response
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")


@app.post("/prices")
def prices(request: PricesRequest):
    if not request.tickers:
        return []

    start = _parse_date(request.start)
    end = _parse_date(request.end) + timedelta(days=1)

    # yfinance 1.0 manages its own curl_cffi session
    data = yf.download(
        request.tickers,
        start=_format_date(start),
        end=_format_date(end),
        group_by="ticker",
        auto_adjust=False,
        threads=True,
        progress=False,
    )

    results: List[dict] = []

    # Handle single ticker case - extract from multi-level columns
    if len(request.tickers) == 1:
        ticker = request.tickers[0]
        # Check if multi-level columns exist
        if hasattr(data.columns, 'nlevels') and data.columns.nlevels > 1:
            if ticker in data.columns.get_level_values(0):
                ticker_df = data[ticker]
                results.extend(_normalize_prices(ticker, ticker_df))
        else:
            # Single-level columns, use data directly
            results.extend(_normalize_prices(ticker, data))
            
        if results:
            return results
    else:
        # Multiple tickers
        for ticker in request.tickers:
            if ticker in data.columns.get_level_values(0):
                ticker_df = data[ticker]
                results.extend(_normalize_prices(ticker, ticker_df))

    if results:
        return results

    # Fallback: per-ticker history if batch download returned nothing
    for ticker in request.tickers:
        try:
            # yfinance 1.0 manages its own curl_cffi session
            history = yf.Ticker(ticker).history(
                start=_format_date(start),
                end=_format_date(end),
                interval="1d",
                auto_adjust=False,
            )
        except Exception:
            continue
        results.extend(_normalize_prices(ticker, history))

    return results


@app.post("/instrument-info")
def instrument_info(request: InstrumentInfoRequest):
    ticker = request.ticker
    try:
        # yfinance 1.0 manages its own curl_cffi session
        info = yf.Ticker(ticker).info
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "ticker": ticker,
        "name": info.get("shortName") or info.get("longName"),
        "currency": info.get("currency"),
        "exchange": info.get("exchange"),
        "sector": info.get("sector"),
        "country": info.get("country"),
        "metadata": info,
    }


@app.post("/fx-rates")
def fx_rates(request: FxRatesRequest):
    if not request.pairs:
        return []

    target_date = _parse_date(request.date)
    next_date = target_date + timedelta(days=1)
    results: List[dict] = []

    for pair in request.pairs:
        ticker = f"{pair}=X"
        # yfinance 1.0 manages its own curl_cffi session
        data = yf.download(
            ticker,
            start=_format_date(target_date),
            end=_format_date(next_date),
            auto_adjust=False,
            progress=False,
        )
        if data is None or data.empty:
            continue
        close_value = data.iloc[-1]["Close"]
        if close_value != close_value:
            continue
        results.append(
            {
                "pair": pair,
                "date": _format_date(target_date),
                "rate": float(close_value),
            }
        )

    return results


@app.post("/search")
def search(request: SearchRequest):
    query = request.query.strip()
    if not query:
        return []

    try:
        try:
            from yfinance import Search  # type: ignore
        except Exception:
            from yfinance.search import Search  # type: ignore

        # yfinance 1.0 manages its own curl_cffi session
        search_result = Search(query)
        quotes = search_result.quotes or []
    except Exception:
        quotes = []

    results: List[dict] = []
    for quote in quotes:
        results.append(
            {
                "ticker": quote.get("symbol"),
                "name": quote.get("shortname") or quote.get("longname"),
                "exchange": quote.get("exchange"),
            }
        )

    if results:
        return results

    return _try_ticker_candidates(query)


@app.post("/news")
def news(request: NewsRequest):
    if not request.tickers:
        return []

    limit = request.limit or 10
    results: List[dict] = []
    for ticker in request.tickers:
        try:
            # yfinance 1.0 manages its own curl_cffi session
            items = yf.Ticker(ticker).news or []
        except Exception:
            continue
        for item in items[:limit]:
            content = item.get("content") or {}
            published = content.get("pubDate") or item.get("providerPublishTime")
            if published and isinstance(published, (int, float)):
                published_at = datetime.utcfromtimestamp(int(published)).isoformat() + "Z"
            elif published:
                published_at = str(published)
            else:
                published_at = datetime.utcnow().isoformat() + "Z"

            source = (
                item.get("publisher")
                or (content.get("provider") or {}).get("displayName")
                or "yfinance"
            )
            title = item.get("title") or content.get("title") or ""
            summary = item.get("summary") or content.get("summary") or content.get("description") or None
            url = (
                item.get("link")
                or (content.get("canonicalUrl") or {}).get("url")
                or (content.get("clickThroughUrl") or {}).get("url")
                or ""
            )

            results.append(
                {
                    "ticker": ticker,
                    "source": source,
                    "title": title,
                    "summary": summary,
                    "url": url,
                    "published_at": published_at,
                    "raw": item,
                }
            )

    return results


@app.post("/fundamentals")
def fundamentals(request: FundamentalsRequest):
    ticker = request.ticker
    try:
        ticker_obj = yf.Ticker(ticker)
        info = ticker_obj.info
        quarterly_financials = ticker_obj.quarterly_financials
        annual_financials = ticker_obj.financials
        quarterly_income = getattr(ticker_obj, "quarterly_income_stmt", None)
        if quarterly_income is None or quarterly_income.empty:
            quarterly_income = quarterly_financials
        annual_income = getattr(ticker_obj, "income_stmt", None)
        if annual_income is None or annual_income.empty:
            annual_income = annual_financials
        quarterly_balance = ticker_obj.quarterly_balance_sheet
        annual_balance = ticker_obj.balance_sheet
        quarterly_cashflow = ticker_obj.quarterly_cashflow
        annual_cashflow = ticker_obj.cashflow
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    def _to_float(value):
        if value is None:
            return None
        try:
            numeric = float(value)
        except Exception:
            return None
        if numeric != numeric:
            return None
        return numeric

    def _series_for(df, keys):
        if df is None or df.empty:
            return None
        normalized_index = {str(idx).strip().lower(): idx for idx in df.index}
        for key in keys:
            normalized_key = str(key).strip().lower()
            if normalized_key in normalized_index:
                return df.loc[normalized_index[normalized_key]]
        return None

    def _ttm_sum(df, keys):
        series = _series_for(df, keys)
        if series is None:
            return None, None
        try:
            items = []
            for idx, value in series.items():
                try:
                    date_value = pd.to_datetime(idx)
                except Exception:
                    date_value = None
                numeric = _to_float(value)
                if date_value is not None:
                    items.append((date_value, numeric))
            if not items:
                return None, None
            items.sort(key=lambda item: item[0], reverse=True)
            total = 0.0
            count = 0
            for date_value, numeric in items[:4]:
                if numeric is None:
                    continue
                total += numeric
                count += 1
            if count == 0:
                return None, None
            return total, items[0][0].strftime("%Y-%m-%d")
        except Exception:
            return None, None

    def _latest_value(df, keys):
        series = _series_for(df, keys)
        if series is None:
            return None
        try:
            items = []
            for idx, value in series.items():
                try:
                    date_value = pd.to_datetime(idx)
                except Exception:
                    date_value = None
                numeric = _to_float(value)
                if date_value is not None:
                    items.append((date_value, numeric))
            if not items:
                return None
            items.sort(key=lambda item: item[0], reverse=True)
            return items[0][1]
        except Exception:
            return None

    revenue_ttm, revenue_date = _ttm_sum(
        quarterly_income, ["Total Revenue", "TotalRevenue", "Operating Revenue", "Revenue"]
    )
    if revenue_ttm is None:
        revenue_ttm, revenue_date = _ttm_sum(annual_income, ["Total Revenue", "TotalRevenue", "Operating Revenue", "Revenue"])
    ebit_ttm, ebit_date = _ttm_sum(quarterly_income, ["Ebit", "EBIT", "Operating Income"])
    if ebit_ttm is None:
        ebit_ttm, ebit_date = _ttm_sum(annual_income, ["Ebit", "EBIT", "Operating Income"])
    ebitda_ttm, ebitda_date = _ttm_sum(quarterly_income, ["EBITDA", "Ebitda"])
    if ebitda_ttm is None:
        ebitda_ttm, ebitda_date = _ttm_sum(annual_income, ["EBITDA", "Ebitda"])
    net_income_ttm, net_income_date = _ttm_sum(
        quarterly_income,
        [
            "Net Income",
            "NetIncome",
            "Net Income Common Stockholders",
            "Net Income Common Stockholders",
            "Net Income Applicable To Common Shares",
        ],
    )
    if net_income_ttm is None:
        net_income_ttm, net_income_date = _ttm_sum(
            annual_income,
            [
                "Net Income",
                "NetIncome",
                "Net Income Common Stockholders",
                "Net Income Common Stockholders",
                "Net Income Applicable To Common Shares",
            ],
        )
    eps_ttm, eps_date = _ttm_sum(quarterly_income, ["EPS", "Earnings Per Share", "Diluted EPS"])
    ocf_ttm, ocf_date = _ttm_sum(
        quarterly_cashflow,
        [
            "Total Cash From Operating Activities",
            "Operating Cash Flow",
            "OperatingCashFlow",
            "Net Cash Provided By Operating Activities",
        ],
    )
    if ocf_ttm is None:
        ocf_ttm, ocf_date = _ttm_sum(
            annual_cashflow,
            [
                "Total Cash From Operating Activities",
                "Operating Cash Flow",
                "OperatingCashFlow",
                "Net Cash Provided By Operating Activities",
            ],
        )
    capex_ttm, capex_date = _ttm_sum(
        quarterly_cashflow,
        [
            "Capital Expenditures",
            "Capital Expenditure",
            "CapitalExpenditures",
            "Capital Expenditure (Purchase Of Property Plant And Equipment)",
        ],
    )
    if capex_ttm is None:
        capex_ttm, capex_date = _ttm_sum(
            annual_cashflow,
            [
                "Capital Expenditures",
                "Capital Expenditure",
                "CapitalExpenditures",
                "Capital Expenditure (Purchase Of Property Plant And Equipment)",
            ],
        )
    tax_expense_ttm, tax_date = _ttm_sum(
        quarterly_income,
        [
            "Income Tax Expense",
            "Income Tax Expense (Gain)",
            "Income Tax Expense (Benefit)",
            "Tax Provision",
        ],
    )
    if tax_expense_ttm is None:
        tax_expense_ttm, tax_date = _ttm_sum(
            annual_income,
            [
                "Income Tax Expense",
                "Income Tax Expense (Gain)",
                "Income Tax Expense (Benefit)",
                "Tax Provision",
            ],
        )
    pretax_income_ttm, pretax_date = _ttm_sum(
        quarterly_income, ["Pretax Income", "Income Before Tax", "Earnings Before Tax"]
    )
    if pretax_income_ttm is None:
        pretax_income_ttm, pretax_date = _ttm_sum(
            annual_income, ["Pretax Income", "Income Before Tax", "Earnings Before Tax"]
        )
    tax_rate = None
    if tax_expense_ttm is not None and pretax_income_ttm not in (None, 0):
        tax_rate = tax_expense_ttm / pretax_income_ttm

    total_equity = _latest_value(
        quarterly_balance,
        [
            "Total Stockholder Equity",
            "Total Stockholders Equity",
            "Stockholders Equity",
            "Total Equity Gross Minority Interest",
        ],
    )
    if total_equity is None:
        total_equity = _latest_value(
            annual_balance,
            [
                "Total Stockholder Equity",
                "Total Stockholders Equity",
                "Stockholders Equity",
                "Total Equity Gross Minority Interest",
            ],
        )
    total_debt = _latest_value(
        quarterly_balance,
        ["Total Debt", "Long Term Debt", "Short Long Term Debt", "Long Term Debt And Capital Lease Obligation"],
    )
    if total_debt is None:
        total_debt = _latest_value(
            annual_balance,
            ["Total Debt", "Long Term Debt", "Short Long Term Debt", "Long Term Debt And Capital Lease Obligation"],
        )
    cash_equivalents = _latest_value(
        quarterly_balance, ["Cash And Cash Equivalents", "Cash And Cash Equivalents And Short Term Investments"]
    )
    if cash_equivalents is None:
        cash_equivalents = _latest_value(
            annual_balance, ["Cash And Cash Equivalents", "Cash And Cash Equivalents And Short Term Investments"]
        )
    shares_outstanding = _latest_value(
        quarterly_balance,
        ["Ordinary Shares Number", "Share Issued", "Common Stock Shares Outstanding", "OrdinarySharesNumber"],
    )
    if shares_outstanding is None:
        shares_outstanding = _latest_value(
            annual_balance,
            ["Ordinary Shares Number", "Share Issued", "Common Stock Shares Outstanding", "OrdinarySharesNumber"],
        )

    as_of_date = None
    for candidate in [
        revenue_date,
        ebitda_date,
        net_income_date,
        ebit_date,
        eps_date,
        ocf_date,
        capex_date,
        tax_date,
        pretax_date,
    ]:
        if candidate:
            as_of_date = candidate
            break

    quote_summary = None
    quote_summary_error = None
    try:
        quote_summary = _fetch_quote_summary(ticker)
        if quote_summary:
            result = (quote_summary.get("quoteSummary") or {}).get("result") or []
            summary = result[0] if result else {}
            income_q = (summary.get("incomeStatementHistoryQuarterly") or {}).get("incomeStatementHistory") or []
            cash_q = (summary.get("cashflowStatementHistoryQuarterly") or {}).get("cashflowStatements") or []
            balance_q = (summary.get("balanceSheetHistoryQuarterly") or {}).get("balanceSheetStatements") or []
            stats = summary.get("defaultKeyStatistics") or {}
            financial_data = summary.get("financialData") or {}

            revenue_ttm = revenue_ttm or _ttm_from_rows(income_q, "totalRevenue")
            if revenue_ttm is None:
                revenue_ttm = _extract_raw(financial_data.get("totalRevenue"))
            ebit_ttm = ebit_ttm or _ttm_from_rows(income_q, "ebit")
            ebitda_ttm = ebitda_ttm or _ttm_from_rows(income_q, "ebitda")
            if ebitda_ttm is None:
                ebitda_ttm = _extract_raw(financial_data.get("ebitda"))
            net_income_ttm = net_income_ttm or _ttm_from_rows(income_q, "netIncome")
            income_tax_expense_ttm = income_tax_expense_ttm or _ttm_from_rows(income_q, "incomeTaxExpense")
            pretax_income_ttm = pretax_income_ttm or _ttm_from_rows(income_q, "incomeBeforeTax")
            if tax_rate is None and income_tax_expense_ttm is not None and pretax_income_ttm not in (None, 0):
                tax_rate = income_tax_expense_ttm / pretax_income_ttm

            operating_cashflow_ttm = operating_cashflow_ttm or _ttm_from_rows(cash_q, "totalCashFromOperatingActivities")
            if operating_cashflow_ttm is None:
                operating_cashflow_ttm = _extract_raw(financial_data.get("operatingCashflow"))
            capital_expenditure_ttm = capital_expenditure_ttm or _ttm_from_rows(cash_q, "capitalExpenditures")
            if capital_expenditure_ttm is None:
                capital_expenditure_ttm = _extract_raw(financial_data.get("capitalExpenditures"))

            total_debt = total_debt or _latest_from_rows(balance_q, "totalDebt")
            if total_debt is None:
                total_debt = _extract_raw(financial_data.get("totalDebt"))
            total_equity = total_equity or _latest_from_rows(balance_q, "totalStockholderEquity")
            if total_equity is None:
                total_equity = _extract_raw(financial_data.get("totalStockholderEquity"))
            cash_equivalents = cash_equivalents or _latest_from_rows(balance_q, "cash")
            if cash_equivalents is None:
                cash_equivalents = _extract_raw(financial_data.get("totalCash"))

            shares_outstanding = shares_outstanding or _extract_raw(stats.get("sharesOutstanding"))

            if income_q:
                end_date_raw = _sort_quote_rows(income_q)[0].get("endDate", {}).get("raw")
                if end_date_raw:
                    as_of_date = as_of_date or str(end_date_raw)[:10]
    except Exception as exc:
        quote_summary_error = str(exc)

    return _clean_json({
        "ticker": ticker,
        "as_of_date": as_of_date or datetime.utcnow().strftime("%Y-%m-%d"),
        "revenue_ttm": revenue_ttm
        if revenue_ttm is not None
        else _to_float(info.get("totalRevenue") or info.get("totalRevenueTTM")),
        "eps_ttm": eps_ttm
        if eps_ttm is not None
        else _to_float(info.get("trailingEps") or info.get("epsTrailingTwelveMonths")),
        "ebitda_ttm": ebitda_ttm
        if ebitda_ttm is not None
        else _to_float(info.get("ebitda") or info.get("ebitdaTTM")),
        "net_income_ttm": net_income_ttm
        if net_income_ttm is not None
        else _to_float(info.get("netIncomeToCommon") or info.get("netIncome") or info.get("netIncomeToCommonTTM")),
        "income_tax_expense_ttm": tax_expense_ttm
        if tax_expense_ttm is not None
        else _to_float(info.get("incomeTaxExpense") or info.get("taxProvision")),
        "operating_cashflow_ttm": ocf_ttm if ocf_ttm is not None else _to_float(info.get("operatingCashflow")),
        "capital_expenditure_ttm": capex_ttm
        if capex_ttm is not None
        else _to_float(info.get("capitalExpenditures") or info.get("capitalExpendituresTTM")),
        "ebit_ttm": ebit_ttm if ebit_ttm is not None else _to_float(info.get("ebit") or info.get("ebitTTM")),
        "tax_rate": tax_rate if tax_rate is not None else _to_float(info.get("taxRate")),
        "total_debt": total_debt if total_debt is not None else _to_float(info.get("totalDebt")),
        "total_equity": total_equity
        if total_equity is not None
        else _to_float(info.get("totalStockholderEquity") or info.get("totalStockholdersEquity")),
        "cash_and_equivalents": cash_equivalents
        if cash_equivalents is not None
        else _to_float(info.get("totalCash") or info.get("cashAndCashEquivalents")),
        "shares_outstanding": shares_outstanding
        if shares_outstanding is not None
        else _to_float(
            info.get("sharesOutstanding")
            or info.get("impliedSharesOutstanding")
            or info.get("floatShares")
        ),
        "raw": {
            "info": _clean_json(info),
            "quarterly_financials": _clean_json(quarterly_financials.where(pd.notnull(quarterly_financials), None).to_dict()) if quarterly_financials is not None and not quarterly_financials.empty else {},
            "quarterly_income_stmt": _clean_json(quarterly_income.where(pd.notnull(quarterly_income), None).to_dict()) if quarterly_income is not None and not quarterly_income.empty else {},
            "quarterly_balance_sheet": _clean_json(quarterly_balance.where(pd.notnull(quarterly_balance), None).to_dict()) if quarterly_balance is not None and not quarterly_balance.empty else {},
            "quarterly_cashflow": _clean_json(quarterly_cashflow.where(pd.notnull(quarterly_cashflow), None).to_dict()) if quarterly_cashflow is not None and not quarterly_cashflow.empty else {},
            "annual_financials": _clean_json(annual_financials.where(pd.notnull(annual_financials), None).to_dict()) if annual_financials is not None and not annual_financials.empty else {},
            "annual_income_stmt": _clean_json(annual_income.where(pd.notnull(annual_income), None).to_dict()) if annual_income is not None and not annual_income.empty else {},
            "annual_balance_sheet": _clean_json(annual_balance.where(pd.notnull(annual_balance), None).to_dict()) if annual_balance is not None and not annual_balance.empty else {},
            "annual_cashflow": _clean_json(annual_cashflow.where(pd.notnull(annual_cashflow), None).to_dict()) if annual_cashflow is not None and not annual_cashflow.empty else {},
            "quote_summary": _clean_json(quote_summary or {}),
            "quote_summary_error": quote_summary_error,
        },
    })


@app.post("/regime-analysis")
def regime_analysis(request: RegimeAnalysisRequest):
    start = _parse_date(request.start_date)
    end = datetime.now(timezone.utc) + timedelta(days=1)
    start_str = _format_date(start)
    end_str = _format_date(end)

    index_df = _safe_history(request.index_ticker, start_str, end_str)
    if "Close" not in index_df.columns:
        raise HTTPException(status_code=400, detail=f"No close data for {request.index_ticker}")

    index_close = index_df["Close"]
    ma_short_series = calculate_ma(index_close, request.ma_short)
    ma_long_series = calculate_ma(index_close, request.ma_long)
    rsi_series = calculate_rsi(index_close, request.rsi_period)

    last_close = _latest_value(index_close)
    last_ma_short = _latest_value(ma_short_series)
    last_ma_long = _latest_value(ma_long_series)
    last_rsi = _latest_value(rsi_series)

    price_vs_ma_status = _status_from_flags(
        last_close is not None and last_ma_long is not None and last_close >= last_ma_long,
        last_close is not None and last_ma_long is not None and last_close < last_ma_long,
    )
    ma_cross_status = _status_from_flags(
        last_ma_short is not None and last_ma_long is not None and last_ma_short >= last_ma_long,
        last_ma_short is not None and last_ma_long is not None and last_ma_short < last_ma_long,
    )
    rsi_status = _status_from_flags(
        last_rsi is not None and last_rsi >= request.rsi_threshold,
        last_rsi is not None and last_rsi < request.rsi_threshold,
    )

    vix_df = _safe_history(request.vix_ticker, start_str, end_str)
    if "Close" not in vix_df.columns:
        raise HTTPException(status_code=400, detail=f"No close data for {request.vix_ticker}")
    vix_close = vix_df["Close"]
    last_vix = _latest_value(vix_close)
    vix_status = "Neutral"
    if last_vix is not None:
        if last_vix <= request.vix_threshold_bull:
            vix_status = "Bull"
        elif last_vix >= request.vix_threshold_bear:
            vix_status = "Bear"

    breadth_status = "Neutral"
    breadth_value = "N/A"
    breadth_score = 0
    tickers = request.component_tickers or []
    if tickers:
        total = 0
        above = 0
        for ticker in tickers:
            try:
                component_df = _safe_history(ticker, start_str, end_str)
            except HTTPException:
                continue
            if "Close" not in component_df.columns:
                continue
            component_close = component_df["Close"]
            component_ma = calculate_ma(component_close, request.ma_long)
            last_component_close = _latest_value(component_close)
            last_component_ma = _latest_value(component_ma)
            if last_component_close is None or last_component_ma is None:
                continue
            total += 1
            if last_component_close >= last_component_ma:
                above += 1
        if total > 0:
            breadth_percent = (above / total) * 100
            breadth_value = f"{breadth_percent:.0f}%"
            if breadth_percent >= 60:
                breadth_status = "Bull"
            elif breadth_percent <= 40:
                breadth_status = "Bear"
            breadth_score = _score_from_status(breadth_status)

    scorecard = [
        {
            "factor": "Price vs MA200",
            "value": f"{last_close:.2f} vs {last_ma_long:.2f}" if last_close is not None and last_ma_long is not None else "N/A",
            "status": price_vs_ma_status,
        },
        {
            "factor": "MA50 vs MA200",
            "value": f"{last_ma_short:.2f} vs {last_ma_long:.2f}" if last_ma_short is not None and last_ma_long is not None else "N/A",
            "status": ma_cross_status,
        },
        {
            "factor": f"RSI({request.rsi_period})",
            "value": f"{last_rsi:.1f}" if last_rsi is not None else "N/A",
            "status": rsi_status,
        },
        {
            "factor": "VIX",
            "value": f"{last_vix:.1f}" if last_vix is not None else "N/A",
            "status": vix_status,
        },
        {
            "factor": "Market Breadth",
            "value": breadth_value,
            "status": breadth_status,
        },
    ]

    total_score = (
        _score_from_status(price_vs_ma_status)
        + _score_from_status(ma_cross_status)
        + _score_from_status(rsi_status)
        + _score_from_status(vix_status)
        + breadth_score
    )

    if total_score >= 2:
        regime = "Bull"
    elif total_score <= -2:
        regime = "Bear"
    else:
        regime = "Neutral"

    price_dates = _index_dates(index_df.index)
    vix_dates = _index_dates(vix_df.index)

    response = {
        "regime": regime,
        "total_score": total_score,
        "scorecard": scorecard,
        "charts": {
            "price_history": {
                "dates": price_dates,
                "close": _series_to_list(index_close),
                "ma50": _series_to_list(ma_short_series),
                "ma200": _series_to_list(ma_long_series),
            },
            "rsi_history": {
                "dates": price_dates,
                "close": [],
                "rsi": _series_to_list(rsi_series),
            },
            "vix_history": {
                "dates": vix_dates,
                "close": [],
                "vix": _series_to_list(vix_close),
            },
        },
    }

    return response


@app.post("/corporate-actions")
def corporate_actions(request: CorporateActionsRequest):
    ticker = request.ticker
    try:
        ticker_obj = yf.Ticker(ticker)
        dividends = ticker_obj.dividends
        splits = ticker_obj.splits
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    dividend_rows: List[dict] = []
    if dividends is not None and not dividends.empty:
        for idx, value in dividends.items():
            try:
                date_value = pd.to_datetime(idx)
                date_str = date_value.strftime("%Y-%m-%d")
            except Exception:
                date_str = str(idx)[:10]
            amount = None
            try:
                amount = float(value)
            except Exception:
                amount = None
            if amount is None or amount != amount:
                continue
            dividend_rows.append({"date": date_str, "dividend": amount})

    split_rows: List[dict] = []
    if splits is not None and not splits.empty:
        for idx, value in splits.items():
            try:
                date_value = pd.to_datetime(idx)
                date_str = date_value.strftime("%Y-%m-%d")
            except Exception:
                date_str = str(idx)[:10]
            ratio = None
            try:
                ratio = float(value)
            except Exception:
                ratio = None
            if ratio is None or ratio != ratio:
                continue
            if ratio >= 1:
                numerator = ratio
                denominator = 1.0
            else:
                numerator = 1.0
                denominator = 1.0 / ratio if ratio != 0 else 1.0
            split_rows.append(
                {"date": date_str, "numerator": numerator, "denominator": denominator}
            )

    return {"ticker": ticker, "dividends": dividend_rows, "splits": split_rows}
