import { getPool, query } from "../db";
import type { PoolClient } from "pg";

export async function withAdvisoryLock<T>(lockId: number, fn: () => Promise<T>) {
  const lock = await query<{ locked: boolean }>(
    "select pg_try_advisory_lock($1) as locked",
    [lockId]
  );
  if (!lock.rows[0]?.locked) {
    return null;
  }
  try {
    return await fn();
  } finally {
    await query("select pg_advisory_unlock($1)", [lockId]);
  }
}

export async function startJobRun(jobName: string, payload?: Record<string, unknown>) {
  const result = await query<{ id: number }>(
    "insert into job_runs (job_name, status, payload) values ($1, $2, $3) returning id",
    [jobName, "running", payload ?? {}]
  );
  return result.rows[0].id;
}

export async function completeJobRun(jobRunId: number) {
  await query(
    "update job_runs set status = $1, completed_at = now(), duration_ms = extract(epoch from (now() - started_at)) * 1000 where id = $2",
    ["completed", jobRunId]
  );
}

export async function failJobRun(jobRunId: number, errorMessage: string) {
  await query(
    "update job_runs set status = $1, completed_at = now(), duration_ms = extract(epoch from (now() - started_at)) * 1000, error_message = $2 where id = $3",
    ["failed", errorMessage, jobRunId]
  );
}

export async function recordFailedJob(
  jobName: string,
  lastError: string,
  payload?: Record<string, unknown>,
  entityType?: string,
  entityId?: number
) {
  await query(
    "insert into failed_jobs (job_name, entity_type, entity_id, last_error, payload) values ($1, $2, $3, $4, $5)",
    [jobName, entityType ?? null, entityId ?? null, lastError, payload ?? {}]
  );
}

export async function logEvent(
  orgId: number,
  type: string,
  entityType: string,
  entityId: number | null,
  payload: Record<string, unknown>
) {
  await query(
    "insert into events (org_id, type, entity_type, entity_id, payload) values ($1, $2, $3, $4, $5)",
    [orgId, type, entityType, entityId, payload]
  );
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
