const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { getPool } = require("./db");

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function login(email, password) {
  const pool = getPool();
  const userResult = await pool.query(
    "select id, password_hash from users where lower(email) = lower($1) and deleted_at is null",
    [email]
  );
  if (userResult.rows.length === 0) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const user = userResult.rows[0];
  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return { ok: false, reason: "invalid_credentials" };
  }

  const refreshToken = crypto.randomBytes(32).toString("hex");
  const refreshTokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await pool.query(
    `insert into user_sessions
      (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
     values ($1, $2, $3, $4, $5)`,
    [user.id, refreshTokenHash, "auth_stub", null, expiresAt]
  );

  return {
    ok: true,
    refreshToken,
    expiresAt: expiresAt.toISOString(),
  };
}

async function main() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: node scripts/auth_stub.js <email> <password>");
    process.exit(1);
  }

  const result = await login(email, password);
  console.log(result);
  await getPool().end();
}

main().catch((err) => {
  console.error("Auth stub failed:", err.message);
  process.exit(1);
});
