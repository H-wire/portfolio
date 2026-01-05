import cron from "node-cron";
import "../config";
import { runPriceImportJob } from "./priceImportJob";
import { runFxImportJob } from "./fxImportJob";
import { runFundamentalsImportJob } from "./fundamentalsImportJob";
import { runCorporateActionsImportJob } from "./corporateActionsImportJob";
import { runRecommendationsJob } from "./recommendationsJob";
import { runNewsImportJob } from "./newsImportJob";
import { runNotificationDigestJob } from "./notificationDigestJob";

const RETRIES = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithRetry(name: string, fn: () => Promise<unknown>) {
  let attempt = 0;
  while (attempt <= RETRIES.length) {
    const start = Date.now();
    try {
      console.log(JSON.stringify({ timestamp: new Date().toISOString(), level: "INFO", message: "job_start", job: name, attempt }));
      await fn();
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "INFO",
          message: "job_complete",
          job: name,
          attempt,
          duration_ms: Date.now() - start,
        })
      );
      return;
    } catch (err) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "ERROR",
          message: "job_error",
          job: name,
          attempt,
          duration_ms: Date.now() - start,
          error: err instanceof Error ? err.message : "Unknown error",
          stack: err instanceof Error ? err.stack : undefined,
        })
      );
      if (attempt >= RETRIES.length) {
        console.error(`${name} failed after retries`, err);
        return;
      }
      const wait = RETRIES[attempt];
      attempt += 1;
      console.warn(`${name} failed, retrying in ${wait}ms`);
      await delay(wait);
    }
  }
}

async function runJobsOnce() {
  await runWithRetry("price_import", runPriceImportJob);
  await runWithRetry("fx_import", runFxImportJob);
  await runWithRetry("fundamentals_import", runFundamentalsImportJob);
  await runWithRetry("corporate_actions_import", runCorporateActionsImportJob);
  await runWithRetry("news_import", runNewsImportJob);
  await runWithRetry("notification_digest", runNotificationDigestJob);
}

const schedule = process.env.JOB_SCHEDULE ?? "0 20 * * *";
cron.schedule(schedule, () => {
  runJobsOnce().catch((err) => {
    console.error("Job run failed:", err);
  });
});

if (process.env.NEWS_RUN_ON_START === "true") {
  runWithRetry("news_import", runNewsImportJob).catch((err) => {
    console.error("News import on start failed:", err);
  });
}

console.log(`Job runner scheduled with ${schedule}`);

const recommendationsSchedule = process.env.RECOMMENDATION_SCHEDULE ?? "0 6 1 * *";
cron.schedule(recommendationsSchedule, () => {
  runWithRetry("recommendations_run", runRecommendationsJob).catch((err) => {
    console.error("Recommendations run failed:", err);
  });
});

console.log(`Recommendations scheduled with ${recommendationsSchedule}`);
