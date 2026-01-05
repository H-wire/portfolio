import type { NextFunction, Request, Response } from "express";
import { sendError } from "../http";

export function requireOrgRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.orgRole;
    if (!role || !roles.includes(role)) {
      return sendError(res, 403, "FORBIDDEN", "Insufficient permissions");
    }
    return next();
  };
}
