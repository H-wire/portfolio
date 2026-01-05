import { Router } from "express";
import bcrypt from "bcrypt";
import { randomBytes, createHash } from "crypto";
import { hashPassword, validatePassword } from "../utils/passwords";
import { sendEmail } from "../utils/email";
import { z } from "zod";
import { getPool, query } from "../db";
import { sendData, sendError } from "../http";
import { createAccessToken, createRefreshToken, hashRefreshToken } from "../utils/tokens";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

const forgotSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(1),
});

const failedLoginAttempts = new Map<
  string,
  { count: number; lockedUntil?: number }
>();

function getLockKey(email: string, ip: string) {
  return `${email.toLowerCase()}::${ip}`;
}

function isLocked(key: string) {
  const record = failedLoginAttempts.get(key);
  if (!record?.lockedUntil) {
    return false;
  }
  return record.lockedUntil > Date.now();
}

function registerFailure(key: string) {
  const current = failedLoginAttempts.get(key) ?? { count: 0 };
  const nextCount = current.count + 1;
  if (nextCount >= 5) {
    failedLoginAttempts.set(key, {
      count: 0,
      lockedUntil: Date.now() + 15 * 60 * 1000,
    });
    return;
  }
  failedLoginAttempts.set(key, { count: nextCount });
}

function clearFailures(key: string) {
  failedLoginAttempts.delete(key);
}

async function resolveOrgId(userId: number) {
  const orgs = await query<{ org_id: number }>(
    "select org_id from org_members where user_id = $1 order by org_id asc limit 1",
    [userId]
  );
  if (orgs.rows.length === 0) {
    return null;
  }
  return orgs.rows[0].org_id;
}


function createResetToken() {
  const token = randomBytes(32).toString("hex");
  const hash = createHash("sha256").update(token).digest("hex");
  return { token, hash };
}
async function logEvent(orgId: number | null, type: string, userId?: number) {
  if (!orgId) {
    return;
  }
  await query(
    "insert into events (org_id, type, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5)",
    [orgId, type, "user", userId ?? null, { source: "api", status: "ok" }]
  );
}

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const lockKey = getLockKey(email, req.ip ?? "unknown");

    if (isLocked(lockKey)) {
      return sendError(res, 429, "RATE_LIMITED", "Account locked for 15 minutes after repeated failed logins.");
    }

    const result = await query<{
      id: number;
      email: string;
      password_hash: string;
    }>("select id, email, password_hash from users where lower(email) = lower($1)", [
      email,
    ]);

    if (result.rows.length === 0) {
      registerFailure(lockKey);
      return sendError(res, 401, "UNAUTHORIZED", "Invalid credentials");
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      registerFailure(lockKey);
      const orgId = await resolveOrgId(user.id);
      await logEvent(orgId, "user_login_failed", user.id);
      return sendError(res, 401, "UNAUTHORIZED", "Invalid credentials");
    }

    clearFailures(lockKey);

    const refreshToken = createRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const userAgent = req.get("User-Agent") ?? null;
    const ipAddress = req.ip ?? null;

    await query(
      "insert into user_sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at) values ($1, $2, $3, $4, $5)",
      [user.id, refreshTokenHash, userAgent, ipAddress, expiresAt]
    );

    await query("update users set last_login_at = now(), updated_at = now() where id = $1", [
      user.id,
    ]);

    const orgId = await resolveOrgId(user.id);
    await logEvent(orgId, "user_login_success", user.id);

    return sendData(res, {
      access_token: createAccessToken(user.id),
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 24 * 60 * 60,
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const { refresh_token: refreshToken } = refreshSchema.parse(req.body);
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const sessionResult = await query<{
      id: number;
      user_id: number;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      "select id, user_id, expires_at, revoked_at from user_sessions where refresh_token_hash = $1",
      [refreshTokenHash]
    );

    if (sessionResult.rows.length === 0) {
      return sendError(res, 401, "UNAUTHORIZED", "Invalid refresh token");
    }

    const session = sessionResult.rows[0];
    if (session.revoked_at || session.expires_at < new Date()) {
      return sendError(res, 401, "UNAUTHORIZED", "Refresh token expired or revoked");
    }

    const newRefreshToken = createRefreshToken();
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
    const newExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await query(
      "update user_sessions set refresh_token_hash = $1, last_used_at = now(), expires_at = $2 where id = $3",
      [newRefreshTokenHash, newExpiresAt, session.id]
    );

    return sendData(res, {
      access_token: createAccessToken(session.user_id),
      refresh_token: newRefreshToken,
      token_type: "Bearer",
      expires_in: 24 * 60 * 60,
    });
  } catch (err) {
    return next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const { refresh_token: refreshToken } = refreshSchema.parse(req.body);
    const refreshTokenHash = hashRefreshToken(refreshToken);
    await query(
      "update user_sessions set revoked_at = now() where refresh_token_hash = $1",
      [refreshTokenHash]
    );
    return sendData(res, { ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    const userResult = await query<{ id: number; email: string }>(
      "select id, email from users where lower(email) = lower($1)",
      [email]
    );

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      const { token, hash } = createResetToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await query(
        "insert into password_reset_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)",
        [user.id, hash, expiresAt]
      );

      const orgId = await resolveOrgId(user.id);
      await logEvent(orgId, "password_reset_requested", user.id);

      const frontendUrl = process.env.FRONTEND_URL ?? "";
      const resetLink = frontendUrl ? `${frontendUrl}/reset?token=${token}` : "";

      await sendEmail({
        to: user.email,
        subject: "Password reset",
        text: `Use this token to reset your password: ${token}\n${resetLink ? `Reset link: ${resetLink}` : ""}`,
      });
    }

    return sendData(res, { ok: true });
  } catch (err) {
    return next(err);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const passwordError = validatePassword(password);
    if (passwordError) {
      return sendError(res, 400, "VALIDATION_ERROR", passwordError);
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const tokenResult = await client.query<{
        id: number;
        user_id: number;
        expires_at: Date;
        used_at: Date | null;
      }>(
        "select id, user_id, expires_at, used_at from password_reset_tokens where token_hash = $1",
        [tokenHash]
      );

      if (tokenResult.rows.length === 0) {
        await client.query("rollback");
        return sendError(res, 400, "VALIDATION_ERROR", "Invalid token");
      }

      const tokenRow = tokenResult.rows[0];
      if (tokenRow.used_at || tokenRow.expires_at < new Date()) {
        await client.query("rollback");
        return sendError(res, 400, "VALIDATION_ERROR", "Token expired or already used");
      }

      const newHash = await hashPassword(password);
      await client.query("update users set password_hash = $1, updated_at = now() where id = $2", [
        newHash,
        tokenRow.user_id,
      ]);
      await client.query("update password_reset_tokens set used_at = now() where id = $1", [
        tokenRow.id,
      ]);
      await client.query("update user_sessions set revoked_at = now() where user_id = $1", [
        tokenRow.user_id,
      ]);

      await client.query("commit");

      const orgId = await resolveOrgId(tokenRow.user_id);
      await logEvent(orgId, "password_reset_completed", tokenRow.user_id);

      return sendData(res, { ok: true });
    } catch (err) {
      await client.query("rollback");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return next(err);
  }
});

export { router as authRouter };
