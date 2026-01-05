import type { Response } from "express";

export type ErrorDetails = { field?: string; message: string };

export function sendData<T>(res: Response, data: T, meta?: Record<string, unknown>) {
  res.json({
    data,
    meta: {
      estimated: false,
      timestamp: new Date().toISOString(),
      ...meta,
    },
  });
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: ErrorDetails[]
) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}
