import { Router } from "express";
import { query } from "../db";
import { sendData, sendError } from "../http";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    if (!req.user?.id) {
      return sendError(res, 401, "UNAUTHORIZED", "Missing user context");
    }

    const userResult = await query<{
      id: number;
      email: string;
      name: string | null;
      last_login_at: Date | null;
    }>("select id, email, name, last_login_at from users where id = $1", [
      req.user.id,
    ]);

    if (userResult.rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "User not found");
    }

    const orgResult = await query<{
      org_id: number;
      name: string;
      role: string;
    }>(
      "select orgs.id as org_id, orgs.name, org_members.role from org_members join orgs on orgs.id = org_members.org_id where org_members.user_id = $1 order by orgs.id asc",
      [req.user.id]
    );

    return sendData(res, {
      user: userResult.rows[0],
      orgs: orgResult.rows,
    });
  } catch (err) {
    return next(err);
  }
});

export { router as meRouter };
