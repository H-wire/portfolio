import { createHmac, randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { config } from "../config";

export function createAccessToken(userId: number) {
  if (!config.jwtSecret) {
    throw new Error("JWT_SECRET is required");
  }
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "24h" });
}

export function createRefreshToken() {
  return randomBytes(32).toString("hex");
}

export function hashRefreshToken(token: string) {
  if (!config.refreshTokenSecret) {
    throw new Error("REFRESH_TOKEN_SECRET is required");
  }
  return createHmac("sha256", config.refreshTokenSecret).update(token).digest("hex");
}
