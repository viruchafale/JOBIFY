/**
 * Phase 8 — Intelligence configuration: parsing + validation of every
 * INTELLIGENCE_* environment variable. Same plain-validation-function
 * convention as Phase 6's scheduler/config.ts — no schema library for env
 * parsing (zod is reserved here for validating untrusted AI output, where
 * it earns its keep much more clearly).
 */

export interface IntelligenceConfig {
  aiEnabled: boolean;
  geminiApiKey: string | null;
  geminiModel: string;
  maxDescriptionLength: number;
  batchSize: number;
  maxConcurrency: number;
  aiTimeoutMs: number;
  workerIntervalMs: number;
}

function parseIntEnv(env: NodeJS.ProcessEnv, name: string, defaultValue: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`invalid ${name}: "${raw}" (must be an integer >= ${min})`);
  }
  return value;
}

function parseBoolEnv(env: NodeJS.ProcessEnv, name: string, defaultValue: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`invalid ${name}: "${raw}" (must be "true" or "false")`);
}

export function loadIntelligenceConfig(env: NodeJS.ProcessEnv): IntelligenceConfig {
  const aiEnabled = parseBoolEnv(env, "INTELLIGENCE_AI_ENABLED", false);
  const geminiApiKey = env.INTELLIGENCE_GEMINI_API_KEY?.trim() || null;

  if (aiEnabled && !geminiApiKey) {
    throw new Error(
      "INTELLIGENCE_AI_ENABLED=true requires INTELLIGENCE_GEMINI_API_KEY to be set.",
    );
  }

  return {
    aiEnabled,
    geminiApiKey,
    geminiModel: env.INTELLIGENCE_GEMINI_MODEL?.trim() || "gemini-3-flash-preview",
    maxDescriptionLength: parseIntEnv(env, "INTELLIGENCE_MAX_DESCRIPTION_LENGTH", 20_000, 500),
    batchSize: parseIntEnv(env, "INTELLIGENCE_BATCH_SIZE", 20, 1),
    maxConcurrency: parseIntEnv(env, "INTELLIGENCE_MAX_CONCURRENCY", 2, 1),
    aiTimeoutMs: parseIntEnv(env, "INTELLIGENCE_AI_TIMEOUT_MS", 15_000, 1000),
    workerIntervalMs: parseIntEnv(env, "INTELLIGENCE_WORKER_INTERVAL_MS", 60_000, 5000),
  };
}
