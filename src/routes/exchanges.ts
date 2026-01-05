import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";
import { requireOrgRole } from "../middleware/roles";

const router = Router({ mergeParams: true });

const exchangeSchema = z.object({
  mic_code: z.string().min(1).max(20),
  name: z.string().min(1),
  country: z.string().min(1),
  timezone: z.string().min(1),
});

router.get("/exchanges", async (_req, res, next) => {
  try {
    const result = await query<{
      id: number;
      mic_code: string | null;
      name: string;
      country: string;
      timezone: string;
    }>("select id, mic_code, name, country, timezone from exchanges order by name asc");

    return sendData(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/exchanges", requireOrgRole(["owner", "admin"]), async (req, res, next) => {
  try {
    const payload = exchangeSchema.parse(req.body);

    const result = await query<{
      id: number;
      mic_code: string | null;
      name: string;
      country: string;
      timezone: string;
    }>(
      "insert into exchanges (mic_code, name, country, timezone) values ($1, $2, $3, $4) returning id, mic_code, name, country, timezone",
      [payload.mic_code, payload.name, payload.country, payload.timezone]
    );

    return res.status(201).json({
      data: result.rows[0],
      meta: {
        estimated: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("duplicate")) {
      return sendError(res, 400, "VALIDATION_ERROR", "Exchange already exists");
    }
    return next(err);
  }
});

export { router as exchangesRouter };
