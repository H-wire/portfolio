import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { sendError } from "../http";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: number;
    };
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return sendError(res, 401, "UNAUTHORIZED", "Missing or invalid access token");
  }
  if (!config.jwtSecret) {
    return sendError(res, 500, "SERVER_ERROR", "JWT secret not configured");
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    if (typeof decoded !== "object" || decoded === null) {
      return sendError(res, 401, "UNAUTHORIZED", "Invalid access token payload");
    }
    const payload = decoded as jwt.JwtPayload;
    const subValue = payload.sub;
    const userId = typeof subValue === "string" ? Number(subValue) : subValue ?? NaN;

    if (!Number.isFinite(userId)) {
      return sendError(res, 401, "UNAUTHORIZED", "Invalid access token payload");
    }
    req.user = { id: userId };
    return next();
  } catch {
    return sendError(res, 401, "UNAUTHORIZED", "Invalid or expired access token");
  }
}
