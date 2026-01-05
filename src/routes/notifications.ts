import { Router } from "express";
import { z } from "zod";
import { query } from "../db";
import { sendData, sendError } from "../http";

const router = Router({ mergeParams: true });

const readSchema = z.object({
  read: z.boolean().optional(),
});

router.get("/notifications", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const userId = req.user?.id ?? 0;

    const result = await query<{
      id: number;
      status: string;
      channel: string;
      sent_at: string | null;
      payload: Record<string, unknown>;
      created_at: string | null;
    }>(
      "select id, status, channel, sent_at, payload, created_at from notifications where org_id = $1 and user_id = $2 order by created_at desc nulls last, id desc limit 50",
      [orgId, userId]
    );

    return sendData(res, result.rows);
  } catch (err) {
    return next(err);
  }
});

router.put("/notifications/:notificationId/read", async (req, res, next) => {
  try {
    const orgId = req.orgId ?? 0;
    const userId = req.user?.id ?? 0;
    const notificationId = Number(req.params.notificationId);
    if (!Number.isFinite(notificationId)) {
      return sendError(res, 400, "VALIDATION_ERROR", "Invalid notification id");
    }

    readSchema.parse(req.body ?? {});

    const result = await query<{ id: number }>(
      "update notifications set status = $1, sent_at = coalesce(sent_at, now()) where id = $2 and org_id = $3 and user_id = $4 returning id",
      ["read", notificationId, orgId, userId]
    );

    if (result.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Notification not found");
    }

    return sendData(res, { ok: true });
  } catch (err) {
    return next(err);
  }
});

export { router as notificationsRouter };
