import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export function requestId(req: Request, res: Response, next: NextFunction) {
  const existing = req.header("X-Request-ID");
  const id = existing ?? randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-ID", id);
  next();
}
