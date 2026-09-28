/**
 * Phase 6 — Lock tests, against an in-memory fake DB that replicates the
 * exact atomic "insert, or steal if expired" semantics the real SQL in
 * lock.ts relies on (see executeSourceIngestion tests / manual live
 * verification for the real-Postgres check of the SQL itself).
 */

import { describe, it, expect } from "vitest";
import type { SqlClient } from "../repository.js";
import { acquireLock, releaseLock } from "./lock.js";

interface FakeLockRow {
  owner_id: string;
  locked_until: Date;
}

function createFakeLockDb(): SqlClient & { locks: Map<string, FakeLockRow> } {
  const locks = new Map<string, FakeLockRow>();
  const query = async (text: string, params: unknown[] = []): Promise<Record<string, any>[]> => {
    if (text.includes("scheduler:acquireLock")) {
      const [source, ownerId, ttlSeconds] = params as [string, string, string];
      const now = new Date();
      const existing = locks.get(source);
      if (!existing || existing.locked_until.getTime() < now.getTime()) {
        locks.set(source, {
          owner_id: ownerId,
          locked_until: new Date(now.getTime() + Number(ttlSeconds) * 1000),
        });
        return [{ owner_id: ownerId }];
      }
      return [];
    }
    if (text.includes("scheduler:releaseLock")) {
      const [source, ownerId] = params as [string, string];
      const existing = locks.get(source);
      if (existing && existing.owner_id === ownerId) locks.delete(source);
      return [];
    }
    throw new Error(`FakeLockDb: unhandled query: ${text.slice(0, 60)}`);
  };
  return { query, locks };
}

describe("acquireLock / releaseLock", () => {
  it("acquires a lock when none exists", async () => {
    const db = createFakeLockDb();
    const acquired = await acquireLock(db, "lever", "owner-a", 1800);
    expect(acquired).toBe(true);
    expect(db.locks.get("lever")?.owner_id).toBe("owner-a");
  });

  it("rejects a second acquisition while the first is still held", async () => {
    const db = createFakeLockDb();
    expect(await acquireLock(db, "lever", "owner-a", 1800)).toBe(true);
    expect(await acquireLock(db, "lever", "owner-b", 1800)).toBe(false);
    expect(db.locks.get("lever")?.owner_id).toBe("owner-a");
  });

  it("allows recovering an expired lock", async () => {
    const db = createFakeLockDb();
    await acquireLock(db, "lever", "owner-a", 1800);
    // Simulate time passing / a crashed owner: force the lock into the past.
    db.locks.set("lever", { owner_id: "owner-a", locked_until: new Date(Date.now() - 1000) });

    const acquired = await acquireLock(db, "lever", "owner-b", 1800);
    expect(acquired).toBe(true);
    expect(db.locks.get("lever")?.owner_id).toBe("owner-b");
  });

  it("is released after success and can be re-acquired by another owner", async () => {
    const db = createFakeLockDb();
    await acquireLock(db, "lever", "owner-a", 1800);
    await releaseLock(db, "lever", "owner-a");
    expect(db.locks.has("lever")).toBe(false);

    const acquired = await acquireLock(db, "lever", "owner-b", 1800);
    expect(acquired).toBe(true);
  });

  it("release is a no-op when called with the wrong owner", async () => {
    const db = createFakeLockDb();
    await acquireLock(db, "lever", "owner-a", 1800);
    await releaseLock(db, "lever", "owner-b"); // wrong owner
    expect(db.locks.get("lever")?.owner_id).toBe("owner-a");
  });

  it("locks are per-source: a lock on one source doesn't block another", async () => {
    const db = createFakeLockDb();
    expect(await acquireLock(db, "lever", "owner-a", 1800)).toBe(true);
    expect(await acquireLock(db, "greenhouse", "owner-a", 1800)).toBe(true);
  });

  it("crash scenario: an owner that never releases is eventually recoverable via TTL expiry", async () => {
    const db = createFakeLockDb();
    // Short TTL to simulate the crash + wait.
    await acquireLock(db, "lever", "owner-crashed", 0);
    // TTL already effectively elapsed (0s) by the time we check again.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const acquired = await acquireLock(db, "lever", "owner-recovered", 1800);
    expect(acquired).toBe(true);
  });
});
