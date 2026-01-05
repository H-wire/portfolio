import type { NextFunction, Request, Response } from "express";
import { query } from "../db";
import { sendError } from "../http";

declare module "express-serve-static-core" {
  interface Request {
    orgId?: number;
    orgRole?: string;
  }
}

export async function requireOrgScope(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const orgId = Number(req.params.orgId);
  if (!orgId) {
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid org id");
  }
  if (!req.user?.id) {
    return sendError(res, 401, "UNAUTHORIZED", "Missing user context");
  }
  const result = await query<{ org_id: number; role: string }>(
    "select org_id, role from org_members where org_id = $1 and user_id = $2",
    [orgId, req.user.id]
  );
  if (result.rows.length === 0) {
    return sendError(res, 403, "FORBIDDEN", "User not allowed in this org");
  }
  req.orgId = orgId;
  req.orgRole = result.rows[0].role;
  return next();
}
