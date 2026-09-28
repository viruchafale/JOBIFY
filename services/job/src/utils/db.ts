import postgres from "postgres"

import dotenv from "dotenv"
dotenv.config()
export const sql=postgres(process.env.DB_URL as string);

// Ingestion/search/intelligence code (repository.ts, search.ts) is written
// against a minimal `SqlClient` interface (`query(text, params)`), the same
// shape @neondatabase/serverless's `neon()` used to return. postgres.js's
// tagged-template client doesn't have a `.query()` method — this adapter
// bridges the two so that existing code needs no further changes.
export const sqlClient = {
  query: (text: string, params?: unknown[]) => sql.unsafe(text, (params ?? []) as any),
};


