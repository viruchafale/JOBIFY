/**
 * Phase 6 — Persistent, DB-backed per-source lease lock.
 *
 * Why not `pg_advisory_lock`: the job service talks to Postgres through
 * `@neondatabase/serverless`'s `neon()` HTTP driver (see utils/db.ts),
 * where each `query()` call is its own HTTP request — there is no
 * guarantee the same underlying connection is held for the lock's entire
 * lifetime, which a session-level advisory lock requires. A row in
 * `ingestion_locks` with a TTL survives across requests, processes, and
 * crashes, and needs nothing more than the same query() surface every
 * other ingestion query already uses.
 *
 * Acquisition is a single atomic statement: insert the lock row, or steal
 * it from an expired holder, in one round trip — never a
 * check-then-write race.
 */

import type { SqlClient } from "../repository.js";

export interface LockResult {
  acquired: boolean;
}

/**
 * Attempts to acquire (or steal, if expired) the lock for `source`.
 * Returns true only if this call's `ownerId` now holds it.
 */
export async function acquireLock(
  db: SqlClient,
  source: string,
  ownerId: string,
  ttlSeconds: number,
): Promise<boolean> {
  const rows = await db.query(
    `/* scheduler:acquireLock */ INSERT INTO ingestion_locks (source, owner_id, locked_until, created_at, updated_at)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval, NOW(), NOW())
     ON CONFLICT (source) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           locked_until = EXCLUDED.locked_until,
           updated_at = NOW()
       WHERE ingestion_locks.locked_until < NOW()
     RETURNING owner_id`,
    [source, ownerId, String(ttlSeconds)],
  );
  return rows.length > 0 && rows[0].owner_id === ownerId;
}

/** Releases the lock only if it's still held by `ownerId` (a no-op otherwise). */
export async function releaseLock(db: SqlClient, source: string, ownerId: string): Promise<void> {
  await db.query(
    `/* scheduler:releaseLock */ DELETE FROM ingestion_locks WHERE source = $1 AND owner_id = $2`,
    [source, ownerId],
  );
}
