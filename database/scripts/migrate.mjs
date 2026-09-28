import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

if (!process.env.DB_URL) {
  console.error("❌ Error: DB_URL environment variable is required.");
  process.exit(1);
}

const sql = postgres(process.env.DB_URL);

async function ensureMigrationTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      checksum VARCHAR(64)
    );
  `;
}

async function getAppliedMigrations() {
  const rows = await sql`SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC;`;
  return new Map(rows.map((r) => [r.version, r]));
}

function calculateChecksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function loadMigrationFiles() {
  const files = await fs.readdir(MIGRATIONS_DIR);
  const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();
  const migrations = [];
  for (const file of sqlFiles) {
    const version = file.split("_")[0];
    const fullPath = path.join(MIGRATIONS_DIR, file);
    const content = await fs.readFile(fullPath, "utf8");
    migrations.push({
      version,
      filename: file,
      path: fullPath,
      content,
      checksum: calculateChecksum(content),
    });
  }
  return migrations;
}

async function status() {
  await ensureMigrationTable();
  const applied = await getAppliedMigrations();
  const available = await loadMigrationFiles();

  const report = available.map((m) => {
    const isApplied = applied.has(m.version);
    return {
      version: m.version,
      migration: m.filename,
      status: isApplied ? "APPLIED" : "PENDING",
      appliedAt: isApplied ? applied.get(m.version).applied_at : "-",
    };
  });

  console.table(report);
}

async function up() {
  await ensureMigrationTable();
  const applied = await getAppliedMigrations();
  const available = await loadMigrationFiles();

  let count = 0;
  for (const migration of available) {
    if (applied.has(migration.version)) {
      continue;
    }

    console.log(`⏳ Applying migration: ${migration.filename}...`);
    try {
      await sql.unsafe(migration.content);
      await sql`
        INSERT INTO schema_migrations (version, name, checksum)
        VALUES (${migration.version}, ${migration.filename}, ${migration.checksum});
      `;
      console.log(`✅ Applied migration: ${migration.filename}`);
      count++;
    } catch (error) {
      console.error(`❌ Migration failed at ${migration.filename}:`, error);
      process.exit(1);
    }
  }

  if (count === 0) {
    console.log("✨ Database is already up to date. No pending migrations.");
  } else {
    console.log(`🎉 Successfully applied ${count} migration(s).`);
  }
}

const command = process.argv[2] || "up";

if (command === "status") {
  status()
    .catch((err) => {
      console.error("Failed to get migration status:", err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
} else if (command === "up") {
  up()
    .catch((err) => {
      console.error("Migration execution failed:", err);
      process.exitCode = 1;
    })
    .finally(() => sql.end());
} else {
  console.log("Usage: node migrate.mjs [up|status]");
  process.exit(1);
}
