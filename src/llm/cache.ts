import { createHash } from "crypto";
import { query } from "../db";

export type CachedAnalysis = {
  id: number;
  response_text: string;
  metadata: Record<string, unknown>;
};

export function buildCacheKey(payload: Record<string, unknown>) {
  const json = JSON.stringify(payload);
  return createHash("sha256").update(json).digest("hex");
}

export async function findCachedAnalysis(
  orgId: number,
  analysisType: string,
  entityId: number | null,
  cacheKey: string
) {
  const result = await query<CachedAnalysis>(
    "select id, response_text, metadata from llm_analyses where org_id = $1 and analysis_type = $2 and entity_id = $3 and metadata->>'cache_key' = $4 and (expires_at is null or expires_at > now()) order by created_at desc limit 1",
    [orgId, analysisType, entityId, cacheKey]
  );
  return result.rows[0] ?? null;
}

export function analysisExpiry(analysisType: string) {
  switch (analysisType) {
    case "SIGNAL_EXPLANATION":
      return 24 * 60 * 60 * 1000;
    case "PORTFOLIO_ANALYSIS":
      return 60 * 60 * 1000;
    case "NEWS_SUMMARY":
      return 24 * 60 * 60 * 1000;
    case "STRATEGY_SUGGESTION":
      return 6 * 60 * 60 * 1000;
    case "MARKET_CONTEXT":
      return 24 * 60 * 60 * 1000;
    case "RECOMMENDATION_EXPLANATION":
      return 24 * 60 * 60 * 1000;
    default:
      return 24 * 60 * 60 * 1000;
  }
}

export async function storeAnalysis(params: {
  orgId: number;
  entityType: string;
  entityId: number | null;
  analysisType: string;
  promptTemplate: string;
  model: string;
  inputData: Record<string, unknown>;
  responseText: string;
  metadata: Record<string, unknown>;
  expiresAt: Date | null;
}) {
  const result = await query<{ id: number }>(
    "insert into llm_analyses (org_id, entity_type, entity_id, analysis_type, prompt_template, model_used, input_data, response_text, metadata, expires_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id",
    [
      params.orgId,
      params.entityType,
      params.entityId,
      params.analysisType,
      params.promptTemplate,
      params.model,
      params.inputData,
      params.responseText,
      params.metadata,
      params.expiresAt,
    ]
  );
  return result.rows[0].id;
}

export async function enforceRateLimits(orgId: number, userId: number) {
  const orgResult = await query<{ count: string }>(
    "select count(*) from llm_analyses where org_id = $1 and created_at > now() - interval '1 hour'",
    [orgId]
  );
  const userResult = await query<{ count: string }>(
    "select count(*) from llm_analyses where org_id = $1 and created_at > now() - interval '1 hour' and metadata->>'user_id' = $2",
    [orgId, String(userId)]
  );

  const orgCount = Number(orgResult.rows[0]?.count ?? 0);
  const userCount = Number(userResult.rows[0]?.count ?? 0);

  if (orgCount >= 100) {
    return { allowed: false, message: "Org LLM rate limit exceeded" };
  }
  if (userCount >= 20) {
    return { allowed: false, message: "User LLM rate limit exceeded" };
  }
  return { allowed: true };
}
