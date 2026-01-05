import { query } from "../db";
import { createRecommendations } from "../services/recommendations";
import { completeJobRun, failJobRun, logEvent, recordFailedJob, startJobRun, withAdvisoryLock } from "./jobUtils";

const LOCK_ID = 1202;

export async function runRecommendationsJob() {
  return withAdvisoryLock(LOCK_ID, async () => {
    const jobRunId = await startJobRun("recommendations_run");
    const riskLevel = Number(process.env.RECOMMENDATION_RISK_LEVEL ?? 5);
    const topN = Number(process.env.RECOMMENDATION_TOP_N ?? 3);

    let created = 0;
    const errors: Array<{ portfolio_id: number; error: string }> = [];

    try {
      const portfolios = await query<{ id: number; org_id: number }>(
        "select id, org_id from portfolios"
      );

      for (const portfolio of portfolios.rows) {
        try {
          const result = await createRecommendations(
            portfolio.org_id,
            portfolio.id,
            riskLevel,
            topN
          );
          if (result.recommendationId) {
            created += 1;
            await logEvent(portfolio.org_id, "RECOMMENDATIONS_CREATED", "recommendation", result.recommendationId, {
              source: "job",
              status: "ok",
              summary: "Monthly recommendations created",
              portfolio_id: portfolio.id,
              risk_level: riskLevel,
              top_n: topN,
              top_tickers: result.items.map((item) => item.ticker),
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown error";
          errors.push({ portfolio_id: portfolio.id, error: message });
          await recordFailedJob(
            "recommendations_run",
            message,
            { portfolio_id: portfolio.id },
            "portfolio",
            portfolio.id
          );
        }
      }

      await completeJobRun(jobRunId);
      const orgs = await query<{ id: number }>("select id from orgs");
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "RECOMMENDATIONS_RUN", "job", null, {
            source: "job",
            status: "ok",
            counts: { created, errors: errors.length },
            errors,
          })
        )
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await failJobRun(jobRunId, message);
      const orgs = await query<{ id: number }>("select id from orgs");
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "RECOMMENDATIONS_RUN", "job", null, {
            source: "job",
            status: "error",
            errors: [{ error: message }],
          })
        )
      );
      throw err;
    }
  });
}
