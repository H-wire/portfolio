import { Router } from "express";
import { z } from "zod";
import { validateStrategyDefinition } from "../domain/strategy";
import { query } from "../db";
import { sendData, sendError } from "../http";

const router = Router({ mergeParams: true });

const strategyCreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
  definition: z.record(z.unknown()),
  cooldown_days: z.number().int().min(0).optional(),
});

const strategyUpdateSchema = strategyCreateSchema.partial();

const targetCreateSchema = z
  .object({
    portfolio_id: z.number().int().positive().nullable().optional(),
    listing_id: z.number().int().positive().nullable().optional(),
    priority: z.number().int().optional(),
    active: z.boolean().optional(),
  })
  .refine((payload) => payload.portfolio_id || payload.listing_id, {
    message: "portfolio_id or listing_id is required",
  });

function parseLimit(value: unknown) {
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function parseCursor(value: unknown) {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

async function ensureStrategy(orgId: number, strategyId: number) {
  const result = await query<{ id: number }>(
    "select id from strategies where id = $1 and org_id = $2",
    [strategyId, orgId]
  );
  return result.rows[0] ?? null;
}

async function ensurePortfolio(orgId: number, portfolioId: number) {
  const result = await query<{ id: number }>(
    "select id from portfolios where id = $1 and org_id = $2",
    [portfolioId, orgId]
  );
  return result.rows[0] ?? null;
}

async function ensureListing(listingId: number) {
  const result = await query<{ id: number }>(
    "select id from listings where id = $1",
    [listingId]
  );
  return result.rows[0] ?? null;
}

async function logEvent(
  orgId: number,
  type: string,
  entityType: string,
  entityId: number | null,
  summary: string,
  payload?: Record<string, unknown>
) {
  await query(
    "insert into events (org_id, type, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5)",
    [orgId, type, entityType, entityId, {
      source: "api",
      status: "ok",
      summary,
      ...payload,
    }]
  );
}

router.get("/strategies", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);

    const params: Array<number> = [orgId, limit + 1];
    let cursorFilter = "";
    if (cursor) {
      params.push(cursor);
      cursorFilter = "and id > $3";
    }

    const result = await query<{
      id: number;
      name: string;
      description: string | null;
      enabled: boolean;
      definition: Record<string, unknown>;
      version: number;
      cooldown_days: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `select id, name, description, enabled, definition, version, cooldown_days, created_at, updated_at
       from strategies
       where org_id = $1 ${cursorFilter}
       order by id asc
       limit $2`,
      params
    );

    const rows = result.rows.slice(0, limit);
    const nextCursor = result.rows.length > limit ? rows[rows.length - 1]?.id ?? null : null;

    return sendData(res, rows, { cursor: nextCursor });
  } catch (err) {
    return next(err);
  }
});

router.post("/strategies", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const payload = strategyCreateSchema.parse(req.body);
    let definition;
    try {
      definition = validateStrategyDefinition(payload.definition);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid strategy definition";
      return sendError(res, 400, "VALIDATION_ERROR", message);
    }

    const result = await query<{
      id: number;
      name: string;
      description: string | null;
      enabled: boolean;
      definition: Record<string, unknown>;
      version: number;
      cooldown_days: number;
      created_at: Date;
      updated_at: Date;
    }>(
      "insert into strategies (org_id, name, description, enabled, definition, cooldown_days) values ($1, $2, $3, $4, $5, $6) returning id, name, description, enabled, definition, version, cooldown_days, created_at, updated_at",
      [
        orgId,
        payload.name,
        payload.description ?? null,
        payload.enabled ?? true,
        definition,
        payload.cooldown_days ?? 30,
      ]
    );

    await logEvent(orgId, "strategy_created", "strategy", result.rows[0].id, "Strategy created");

    return res.status(201).json({
      data: result.rows[0],
      meta: {
        estimated: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get("/strategies/:strategyId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const strategyId = Number(req.params.strategyId);
    if (!Number.isFinite(strategyId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid strategy id");
    }

    const result = await query<{
      id: number;
      name: string;
      description: string | null;
      enabled: boolean;
      definition: Record<string, unknown>;
      version: number;
      cooldown_days: number;
      created_at: Date;
      updated_at: Date;
    }>(
      "select id, name, description, enabled, definition, version, cooldown_days, created_at, updated_at from strategies where id = $1 and org_id = $2",
      [strategyId, orgId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Strategy not found");
    }

    return sendData(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.put("/strategies/:strategyId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const strategyId = Number(req.params.strategyId);
    if (!Number.isFinite(strategyId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid strategy id");
    }

    const payload = strategyUpdateSchema.parse(req.body);

    let definition: ReturnType<typeof validateStrategyDefinition> | null = null;
    if (payload.definition) {
      try {
        definition = validateStrategyDefinition(payload.definition);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid strategy definition";
        return sendError(res, 400, "VALIDATION_ERROR", message);
      }
    }
    if (Object.keys(payload).length === 0) {
      return sendError(res, 400, "VALIDATION_ERROR", "No fields to update");
    }

    const result = await query<{
      id: number;
      name: string;
      description: string | null;
      enabled: boolean;
      definition: Record<string, unknown>;
      version: number;
      cooldown_days: number;
      created_at: Date;
      updated_at: Date;
    }>(
      "update strategies set name = coalesce($1, name), description = coalesce($2, description), enabled = coalesce($3, enabled), definition = coalesce($4, definition), cooldown_days = coalesce($5, cooldown_days), version = case when $4 is null then version else version + 1 end, updated_at = now() where id = $6 and org_id = $7 returning id, name, description, enabled, definition, version, cooldown_days, created_at, updated_at",
      [
        payload.name ?? null,
        payload.description ?? null,
        payload.enabled ?? null,
        definition,
        payload.cooldown_days ?? null,
        strategyId,
        orgId,
      ]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Strategy not found");
    }

    await logEvent(orgId, "strategy_updated", "strategy", strategyId, "Strategy updated");

    return sendData(res, result.rows[0]);
  } catch (err) {
    return next(err);
  }
});

router.delete("/strategies/:strategyId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const strategyId = Number(req.params.strategyId);
    if (!Number.isFinite(strategyId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid strategy id");
    }

    const result = await query<{ id: number }>(
      "delete from strategies where id = $1 and org_id = $2 returning id",
      [strategyId, orgId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Strategy not found");
    }

    await logEvent(orgId, "strategy_deleted", "strategy", strategyId, "Strategy deleted");

    return sendData(res, { ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post("/strategies/:strategyId/targets", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const strategyId = Number(req.params.strategyId);
    if (!Number.isFinite(strategyId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid strategy id");
    }

    const payload = targetCreateSchema.parse(req.body);
    const strategy = await ensureStrategy(orgId, strategyId);
    if (!strategy) {
      return sendError(res, 404, "NOT_FOUND", "Strategy not found");
    }

    if (payload.portfolio_id) {
      const portfolio = await ensurePortfolio(orgId, payload.portfolio_id);
      if (!portfolio) {
        return sendError(res, 400, "VALIDATION_ERROR", "Portfolio not found");
      }
    }

    if (payload.listing_id) {
      const listing = await ensureListing(payload.listing_id);
      if (!listing) {
        return sendError(res, 400, "VALIDATION_ERROR", "Listing not found");
      }
    }

    const result = await query<{
      id: number;
      strategy_id: number;
      portfolio_id: number | null;
      listing_id: number | null;
      priority: number;
      active: boolean;
      created_at: Date;
    }>(
      "insert into strategy_targets (org_id, strategy_id, portfolio_id, listing_id, priority, active) values ($1, $2, $3, $4, $5, $6) returning id, strategy_id, portfolio_id, listing_id, priority, active, created_at",
      [
        orgId,
        strategyId,
        payload.portfolio_id ?? null,
        payload.listing_id ?? null,
        payload.priority ?? 0,
        payload.active ?? true,
      ]
    );

    await logEvent(orgId, "strategy_target_created", "strategy_target", result.rows[0].id, "Strategy target created");

    return res.status(201).json({
      data: result.rows[0],
      meta: {
        estimated: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.delete("/strategies/:strategyId/targets/:targetId", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const strategyId = Number(req.params.strategyId);
    const targetId = Number(req.params.targetId);
    if (!Number.isFinite(strategyId) || !Number.isFinite(targetId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid strategy or target id");
    }

    const result = await query<{ id: number }>(
      "delete from strategy_targets where id = $1 and org_id = $2 and strategy_id = $3 returning id",
      [targetId, orgId, strategyId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Target not found");
    }

    await logEvent(orgId, "strategy_target_deleted", "strategy_target", targetId, "Strategy target deleted");

    return sendData(res, { ok: true });
  } catch (err) {
    return next(err);
  }
});

router.get("/signals", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const limit = parseLimit(req.query.limit);
    const cursor = parseCursor(req.query.cursor);
    const strategyId = req.query.strategyId ? Number(req.query.strategyId) : null;
    const listingId = req.query.listingId ? Number(req.query.listingId) : null;
    const portfolioId = req.query.portfolioId ? Number(req.query.portfolioId) : null;
    const signalType = typeof req.query.type === "string" ? req.query.type : null;
    const fromDate = typeof req.query.from === "string" ? req.query.from : null;
    const toDate = typeof req.query.to === "string" ? req.query.to : null;

    if (strategyId !== null && !Number.isFinite(strategyId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid strategy id");
    }
    if (listingId !== null && !Number.isFinite(listingId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid listing id");
    }
    if (portfolioId !== null && !Number.isFinite(portfolioId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid portfolio id");
    }

    const conditions: string[] = ["signals.org_id = $1"];
    const params: Array<unknown> = [orgId, limit + 1];
    let paramIndex = 2;

    if (cursor) {
      paramIndex += 1;
      params.push(cursor);
      conditions.push(`signals.id > $${paramIndex}`);
    }

    if (strategyId) {
      paramIndex += 1;
      params.push(strategyId);
      conditions.push(`signals.strategy_id = $${paramIndex}`);
    }

    if (listingId) {
      paramIndex += 1;
      params.push(listingId);
      conditions.push(`signals.listing_id = $${paramIndex}`);
    }

    if (signalType) {
      paramIndex += 1;
      params.push(signalType);
      conditions.push(`signals.signal_type = $${paramIndex}`);
    }

    if (fromDate) {
      paramIndex += 1;
      params.push(fromDate);
      conditions.push(`signals.date >= $${paramIndex}`);
    }

    if (toDate) {
      paramIndex += 1;
      params.push(toDate);
      conditions.push(`signals.date <= $${paramIndex}`);
    }

    let joinTargets = "";
    if (portfolioId) {
      paramIndex += 1;
      params.push(portfolioId);
      joinTargets =
        "join strategy_targets on strategy_targets.strategy_id = signals.strategy_id and strategy_targets.org_id = signals.org_id";
      conditions.push(
        `(strategy_targets.portfolio_id = $${paramIndex}) and (strategy_targets.listing_id is null or strategy_targets.listing_id = signals.listing_id)`
      );
      conditions.push("strategy_targets.active = true");
    }

    const result = await query<{
      id: number;
      strategy_id: number;
      listing_id: number;
      date: string;
      signal_type: string;
      score: string | null;
      payload: Record<string, unknown>;
      created_at: Date;
      ticker: string | null;
      instrument_name: string | null;
    }>(
      `select signals.id,
              signals.strategy_id,
              signals.listing_id,
              signals.date,
              signals.signal_type,
              signals.score,
              signals.payload,
              signals.created_at,
              listings.ticker,
              instruments.name as instrument_name
       from signals
       join listings on listings.id = signals.listing_id
       join instruments on instruments.id = listings.instrument_id
       ${joinTargets}
       where ${conditions.join(" and ")}
       order by signals.id asc
       limit $2`,
      params
    );

    const rows = result.rows.slice(0, limit);
    const nextCursor = result.rows.length > limit ? rows[rows.length - 1]?.id ?? null : null;

    return sendData(res, rows, { cursor: nextCursor });
  } catch (err) {
    return next(err);
  }
});

export { router as strategiesRouter };
