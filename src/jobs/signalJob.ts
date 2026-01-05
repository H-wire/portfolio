import { query } from "../db";
import { scoreBuySignal } from "../domain/signalScore";
import { evaluateStrategy } from "../domain/strategyEngine";
import { maxLookback, validateStrategyDefinition } from "../domain/strategy";
import { failJobRun, logEvent, recordFailedJob, startJobRun, completeJobRun, withAdvisoryLock } from "./jobUtils";

const LOCK_ID = 1002;

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

async function loadTargets(orgId: number, strategyId: number) {
  const targets = await query<{
    id: number;
    portfolio_id: number | null;
    listing_id: number | null;
  }>(
    "select id, portfolio_id, listing_id from strategy_targets where org_id = $1 and strategy_id = $2 and active = true",
    [orgId, strategyId]
  );

  const listingIds = new Set<number>();
  for (const target of targets.rows) {
    if (target.listing_id) {
      listingIds.add(target.listing_id);
    }
    if (target.portfolio_id) {
      const portfolioListings = await query<{ listing_id: number }>(
        "select distinct listing_id from transactions where org_id = $1 and portfolio_id = $2",
        [orgId, target.portfolio_id]
      );
      portfolioListings.rows.forEach((row) => listingIds.add(row.listing_id));
    }
  }

  return Array.from(listingIds);
}

async function loadPrices(listingId: number, lookback: number) {
  const rows = await query<{ date: string; close: string }>(
    `select date, close from (
       select date, close from prices_eod where listing_id = $1 order by date desc limit $2
     ) t order by date asc`,
    [listingId, lookback]
  );

  return rows.rows.map((row) => ({ date: row.date, close: Number(row.close) }));
}

async function notifyBuySignals(orgId: number, signalId: number, listingId: number) {
  const users = await query<{ user_id: number }>(
    "select user_id from org_members where org_id = $1",
    [orgId]
  );

  for (const user of users.rows) {
    await query(
      "insert into notifications (org_id, user_id, status, channel, payload) values ($1, $2, $3, $4, $5)",
      [
        orgId,
        user.user_id,
        "pending",
        "alert",
        {
          type: "BUY_SIGNAL",
          signal_id: signalId,
          listing_id: listingId,
        },
      ]
    );
  }
}

async function isInCooldown(
  orgId: number,
  strategyId: number,
  listingId: number,
  signalType: string,
  cooldownDays: number
) {
  if (cooldownDays <= 0) {
    return false;
  }
  const threshold = formatDate(new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000));
  const result = await query<{ id: number }>(
    "select id from signals where org_id = $1 and strategy_id = $2 and listing_id = $3 and signal_type = $4 and date >= $5 limit 1",
    [orgId, strategyId, listingId, signalType, threshold]
  );
  return result.rows.length > 0;
}

export async function runSignalJob() {
  return withAdvisoryLock(LOCK_ID, async () => {
    const jobRunId = await startJobRun("signal_run");
    let created = 0;
    const errors: Array<{ strategy_id: number; listing_id: number; error: string }> = [];

    try {
      const strategies = await query<{
        id: number;
        org_id: number;
        definition: Record<string, unknown>;
        cooldown_days: number;
      }>("select id, org_id, definition, cooldown_days from strategies where enabled = true");

      for (const strategy of strategies.rows) {
        let definition;
        try {
          definition = validateStrategyDefinition(strategy.definition);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Invalid strategy definition";
          errors.push({ strategy_id: strategy.id, listing_id: 0, error: message });
          await recordFailedJob("signal_run", message, { strategy_id: strategy.id }, "strategy", strategy.id);
          continue;
        }

        const lookback = Math.min(500, maxLookback(definition.indicators));
        const listingIds = await loadTargets(strategy.org_id, strategy.id);

        for (const listingId of listingIds) {
          try {
            const prices = await loadPrices(listingId, lookback);
            if (prices.length < lookback) {
              errors.push({
                strategy_id: strategy.id,
                listing_id: listingId,
                error: "Insufficient price history",
              });
              continue;
            }

            const signals = evaluateStrategy(definition, prices);
            if (signals.length === 0) {
              continue;
            }

            const scoreResult = signals.some((signal) => signal.signal_type === "BUY")
              ? scoreBuySignal(prices)
              : null;
            const latestDate = prices[prices.length - 1].date;
            for (const signal of signals) {
              const cooldown = await isInCooldown(
                strategy.org_id,
                strategy.id,
                listingId,
                signal.signal_type,
                strategy.cooldown_days
              );
              if (cooldown) {
                continue;
              }

              const basePayload = signal.payload ?? {};
              const scoredPayload =
                signal.signal_type === "BUY" && scoreResult
                  ? {
                      ...basePayload,
                      rule_reason: (basePayload as Record<string, unknown>).reason,
                      score: scoreResult.score,
                      components: scoreResult.components,
                      reason: scoreResult.reason,
                    }
                  : basePayload;
              const scoreValue = signal.signal_type === "BUY" && scoreResult ? scoreResult.score : null;

              const result = await query<{ id: number }>(
                "insert into signals (org_id, strategy_id, listing_id, date, signal_type, score, payload) values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing returning id",
                [
                  strategy.org_id,
                  strategy.id,
                  listingId,
                  latestDate,
                  signal.signal_type,
                  scoreValue,
                  scoredPayload,
                ]
              );

              if (result.rows.length > 0) {
                created += 1;
                const createdSignalId = result.rows[0].id;
                await logEvent(strategy.org_id, "SIGNAL_TRIGGERED", "signal", createdSignalId, {
                  source: "job",
                  status: "ok",
                  summary: "Signal triggered",
                  signal_type: signal.signal_type,
                  strategy_id: strategy.id,
                  listing_id: listingId,
                });
                if (signal.signal_type === "BUY") {
                  await notifyBuySignals(strategy.org_id, createdSignalId, listingId);
                }
              }
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : "Unknown error";
            errors.push({ strategy_id: strategy.id, listing_id: listingId, error: message });
            await recordFailedJob(
              "signal_run",
              message,
              { strategy_id: strategy.id, listing_id: listingId },
              "listing",
              listingId
            );
          }
        }
      }

      await completeJobRun(jobRunId);
      const orgs = await query<{ id: number }>("select id from orgs");
      await Promise.all(
        orgs.rows.map((org) =>
          logEvent(org.id, "SIGNAL_RUN", "job", null, {
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
          logEvent(org.id, "SIGNAL_RUN", "job", null, {
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
