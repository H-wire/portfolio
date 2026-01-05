const { getPool } = require("./db");

async function main() {
  const pool = getPool();
  const result = await pool.query("select now() as now, 1 as ok");
  console.log(result.rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error("Health check failed:", err.message);
  process.exit(1);
});
