import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";
import { requireAuth } from "../middleware/auth";

const router = Router();

const orgCreateSchema = z.object({
  name: z.string().min(1),
});

async function logEvent(orgId: number, type: string, userId: number, summary: string) {
  await query(
    "insert into events (org_id, type, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5)",
    [orgId, type, "org", orgId, { source: "api", status: "ok", summary, user_id: userId }]
  );
}

router.get("/orgs", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 401, "UNAUTHORIZED", "Missing user context");
    }

    const result = await query<{
      org_id: number;
      name: string;
      role: string;
      created_at: Date;
    }>(
      "select orgs.id as org_id, orgs.name, org_members.role, orgs.created_at from org_members join orgs on orgs.id = org_members.org_id where org_members.user_id = $1 order by orgs.id asc",
      [userId]
    );

    return sendData(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

router.post("/orgs", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return sendError(res, 401, "UNAUTHORIZED", "Missing user context");
    }

    const payload = orgCreateSchema.parse(req.body);

    const orgResult = await query<{ id: number; name: string; created_at: Date }>(
      "insert into orgs (name) values ($1) returning id, name, created_at",
      [payload.name]
    );

    const orgId = orgResult.rows[0].id;
    await query(
      "insert into org_members (org_id, user_id, role) values ($1, $2, $3)",
      [orgId, userId, "owner"]
    );

    await logEvent(orgId, "org_created", userId, "Organization created");

    return res.status(201).json({
      data: orgResult.rows[0],
      meta: {
        estimated: false,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return next(err);
  }
});

export { router as orgsRouter };
