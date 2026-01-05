const bcrypt = require("bcrypt");
const { getPool } = require("./db");

const DEFAULT_ORG = "Haborn Invest & Consulting";
const DEFAULT_USER = {
  email: "admin@example.com",
  name: "Admin User",
  password: "ChangeMe12345",
  role: "owner",
};

const DEFAULT_EXCHANGES = [
  { mic_code: "XNAS", name: "NASDAQ", country: "US", timezone: "America/New_York" },
  { mic_code: "XNYS", name: "NYSE", country: "US", timezone: "America/New_York" },
  { mic_code: "ARCX", name: "NYSE Arca", country: "US", timezone: "America/New_York" },
  { mic_code: "BATS", name: "Cboe BZX", country: "US", timezone: "America/New_York" },
  { mic_code: "XSTO", name: "Nasdaq Stockholm", country: "SE", timezone: "Europe/Stockholm" },
  { mic_code: "XNGM", name: "NGM", country: "SE", timezone: "Europe/Stockholm" },
  { mic_code: "XSAT", name: "Spotlight", country: "SE", timezone: "Europe/Stockholm" },
];

async function ensureExchanges(client) {
  for (const exchange of DEFAULT_EXCHANGES) {
    const existing = await client.query(
      "select id from exchanges where mic_code = $1",
      [exchange.mic_code]
    );
    if (existing.rows.length > 0) {
      continue;
    }
    await client.query(
      "insert into exchanges (mic_code, name, country, timezone) values ($1, $2, $3, $4)",
      [exchange.mic_code, exchange.name, exchange.country, exchange.timezone]
    );
  }
}

async function ensureOrg(client) {
  const existing = await client.query(
    "select id from orgs where name = $1",
    [DEFAULT_ORG]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }
  const result = await client.query(
    "insert into orgs (name) values ($1) returning id",
    [DEFAULT_ORG]
  );
  return result.rows[0].id;
}

async function ensureUser(client) {
  const existing = await client.query(
    "select id from users where lower(email) = lower($1)",
    [DEFAULT_USER.email]
  );
  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }
  const passwordHash = await bcrypt.hash(DEFAULT_USER.password, 12);
  const result = await client.query(
    "insert into users (email, name, password_hash) values ($1, $2, $3) returning id",
    [DEFAULT_USER.email, DEFAULT_USER.name, passwordHash]
  );
  return result.rows[0].id;
}

async function ensureOrgMember(client, orgId, userId) {
  await client.query(
    "insert into org_members (org_id, user_id, role) values ($1, $2, $3) on conflict do nothing",
    [orgId, userId, DEFAULT_USER.role]
  );
}

async function main() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const orgId = await ensureOrg(client);
    const userId = await ensureUser(client);
    await ensureOrgMember(client, orgId, userId);
    await ensureExchanges(client);
    await client.query("commit");
    console.log("Seed complete:", {
      org: DEFAULT_ORG,
      user: DEFAULT_USER.email,
      password: DEFAULT_USER.password,
    });
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
