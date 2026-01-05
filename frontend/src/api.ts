import type { RegimeAnalysis } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
};

export function getAccessToken() {
  return localStorage.getItem("access_token");
}

export function setAccessToken(token: string) {
  localStorage.setItem("access_token", token);
}

export async function apiFetch<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const baseMessage = body?.error?.message ?? "Request failed";
    const details = Array.isArray(body?.error?.details)
      ? body.error.details.map((detail: { field?: string; message?: string }) => {
          if (detail.field) {
            return `${detail.field}: ${detail.message}`;
          }
          return detail.message ?? "";
        })
      : [];
    const message = details.length > 0 ? `${baseMessage} (${details.join(", ")})` : baseMessage;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function login(email: string, password: string) {
  const response = await apiFetch<{ data: LoginResponse }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(response.data.access_token);
  return response.data;
}

export async function fetchPortfolioAnalysis(orgId: number, portfolioId: number) {
  return apiFetch<{ data: { id: number; response_text: string } }>(
    `/orgs/${orgId}/analysis/portfolio/${portfolioId}`,
    {
      method: "POST",
    }
  );
}

export async function fetchRecommendationExplanation(
  orgId: number,
  payload: { portfolioId: number; listingId: number; riskLevel: number; topN: number }
) {
  return apiFetch<{ data: { id: number; response_text: string } }>(
    `/orgs/${orgId}/analysis/recommendation`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export async function fetchRegimeAnalysis(
  orgId: number,
  payload: {
    index_ticker: string;
    vix_ticker: string;
    start_date: string;
    ma_short: number;
    ma_long: number;
    rsi_period: number;
    rsi_threshold: number;
    vix_threshold_bull: number;
    vix_threshold_bear: number;
    component_tickers?: string[];
  }
) {
  return apiFetch<{ data: RegimeAnalysis }>(`/orgs/${orgId}/analysis/regime`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchHealth() {
  return apiFetch<{ data: { status: string; db: boolean; market_data?: string | null } }>(`/health`);
}

export async function fetchNews(orgId: number, portfolioId?: number | null) {
  const suffix = portfolioId ? `?portfolioId=${portfolioId}` : "";
  return apiFetch<{ data: unknown[] }>(`/orgs/${orgId}/news${suffix}`);
}

export async function fetchNotifications(orgId: number) {
  return apiFetch<{ data: unknown[] }>(`/orgs/${orgId}/notifications`);
}

export async function markNotificationRead(orgId: number, notificationId: number) {
  return apiFetch<{ data: { ok: boolean } }>(
    `/orgs/${orgId}/notifications/${notificationId}/read`,
    {
      method: "PUT",
      body: JSON.stringify({ read: true }),
    }
  );
}

export async function fetchExchanges(orgId: number) {
  return apiFetch<{ data: unknown[] }>(`/orgs/${orgId}/exchanges`);
}

export async function fetchPortfolioSummary(orgId: number, portfolioId: number) {
  return apiFetch<{ data: unknown }>(`/orgs/${orgId}/portfolios/${portfolioId}/summary`);
}

export async function fetchListingPrices(
  orgId: number,
  listingId: number,
  range: { from?: string; to?: string; range?: string; portfolioId?: number }
) {
  const params = new URLSearchParams();
  if (range.from) {
    params.set("from", range.from);
  }
  if (range.to) {
    params.set("to", range.to);
  }
  if (range.range) {
    params.set("range", range.range);
  }
  if (range.portfolioId) {
    params.set("portfolioId", String(range.portfolioId));
  }
  const query = params.toString();
  return apiFetch<{ data: unknown[] }>(
    `/orgs/${orgId}/listings/${listingId}/prices${query ? `?${query}` : ""}`
  );
}

export async function fetchListingPriceAvailability(
  orgId: number,
  portfolioId: number,
  listingId: number
) {
  return apiFetch<{ data: unknown }>(
    `/orgs/${orgId}/listings/${listingId}/prices/availability?portfolioId=${portfolioId}`
  );
}

export async function fetchListingFundamentals(orgId: number, listingId: number) {
  return apiFetch<{ data: unknown }>(`/orgs/${orgId}/listings/${listingId}/fundamentals/latest`);
}

export async function backfillListingPrices(
  orgId: number,
  listingId: number,
  payload: { from: string; to?: string }
) {
  return apiFetch<{ data: unknown }>(
    `/orgs/${orgId}/listings/${listingId}/prices/backfill`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

export async function fetchHoldingTransactions(
  orgId: number,
  portfolioId: number,
  listingId: number
) {
  return apiFetch<{ data: unknown[] }>(
    `/orgs/${orgId}/portfolios/${portfolioId}/holdings/${listingId}/transactions`
  );
}

export async function deleteTransaction(
  orgId: number,
  portfolioId: number,
  transactionId: number
) {
  return apiFetch<{ data: unknown }>(
    `/orgs/${orgId}/portfolios/${portfolioId}/transactions/${transactionId}`,
    { method: "DELETE" }
  );
}

export async function createExchange(
  orgId: number,
  payload: { mic_code: string; name: string; country: string; timezone: string }
) {
  return apiFetch<{ data: unknown }>(`/orgs/${orgId}/exchanges`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}





export async function createTransaction(
  orgId: number,
  portfolioId: number,
  payload: {
    listing_id: number;
    trade_date: string;
    type: string;
    quantity: number;
    price: number;
    currency: string;
    fees?: number | null;
  }
) {
  return apiFetch<{ data: unknown }>(`/orgs/${orgId}/portfolios/${portfolioId}/transactions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function seedPosition(
  orgId: number,
  portfolioId: number,
  listingId: number,
  payload: {
    quantity: number;
    avg_cost: number;
    cost_currency: string;
    first_buy_date: string;
    notes?: string | null;
  }
) {
  return apiFetch<{ data: unknown }>(
    `/orgs/${orgId}/portfolios/${portfolioId}/positions/${listingId}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    }
  );
}

export async function searchMarketData(query: string) {
  return apiFetch<{ data: Array<{ ticker: string; name?: string | null; exchange?: string | null }> }>(
    `/market-data/search`,
    {
      method: "POST",
      body: JSON.stringify({ query }),
    }
  );
}

export async function fetchLatestRecommendations(orgId: number, portfolioId: number) {
  return apiFetch<{ data: unknown }>(
    `/orgs/${orgId}/portfolios/${portfolioId}/recommendations/latest`
  );
}

export async function fetchFactorScores(orgId: number, portfolioId: number) {
  return apiFetch<{ data: unknown }>(
    `/orgs/${orgId}/portfolios/${portfolioId}/factor-scores`
  );
}

export async function runRecommendations(
  orgId: number,
  portfolioId: number,
  payload: { riskLevel: number; topN: number }
) {
  return apiFetch<{ data: unknown }>(
    `/orgs/${orgId}/portfolios/${portfolioId}/recommendations/run`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    }
  );
}

