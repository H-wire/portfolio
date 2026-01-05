import rateLimit from "express-rate-limit";
import type { Request } from "express";

const authLimit = process.env.NODE_ENV === "production" ? 5 : 30;

export const authRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: authLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
});

const apiLimit = process.env.NODE_ENV === "production" ? 100 : 600;

export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: apiLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    if (req.user?.id) {
      return `user:${req.user.id}`;
    }
    return req.ip ?? "unknown";
  },
});
