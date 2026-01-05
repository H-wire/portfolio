import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { sendError } from "../http";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof ZodError) {
    const details = err.errors.map((issue) => ({
      field: issue.path.join("."),
      message: issue.message,
    }));
    return sendError(res, 400, "VALIDATION_ERROR", "Invalid input data", details);
  }

  if (err instanceof Error && err.message === "Not allowed by CORS") {
    return sendError(res, 403, "CORS_DENIED", "Origin not allowed");
  }

  const message = err instanceof Error ? err.message : "Unknown error";
  console.error(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "ERROR",
      message: "request_failed",
      request_id: req.requestId,
      method: req.method,
      path: req.originalUrl ?? req.url,
      org_id: req.orgId ?? null,
      user_id: req.user?.id ?? null,
      error: message,
      stack: err instanceof Error ? err.stack : undefined,
    })
  );

  return sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
}
