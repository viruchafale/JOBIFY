/**
 * Phase 3 — Source registry.
 *
 * The application learns about sources here (never via hardcoded switch
 * statements scattered through the ingestion system). Adding a new source:
 *
 *   1. Implement JobSourceAdapter (see adapter.ts, e.g. LeverAdapter).
 *   2. Register it in sources/index.ts via sourceRegistry.register(...).
 *   3. Seed its metadata row (see database/migrations/002_* seed pattern).
 */

import type { JobSourceAdapter } from "./adapter.js";

export type SourceType = "fixture" | "api" | "feed";

export interface SourceDefinition {
  /** Stable identifier, must match the adapter's `source`. */
  source: string;
  displayName: string;
  enabled: boolean;
  sourceType: SourceType;
  baseUrl?: string | null;
  policyUrl?: string | null;
  createAdapter: () => JobSourceAdapter;
}

export class SourceRegistry {
  private readonly definitions = new Map<string, SourceDefinition>();

  register(definition: SourceDefinition): void {
    if (this.definitions.has(definition.source)) {
      throw new Error(
        `Source "${definition.source}" is already registered.`,
      );
    }
    this.definitions.set(definition.source, definition);
  }

  get(source: string): SourceDefinition {
    const definition = this.definitions.get(source);
    if (!definition) {
      throw new Error(`Unknown job source: "${source}".`);
    }
    return definition;
  }

  list(): SourceDefinition[] {
    return [...this.definitions.values()];
  }

  listEnabled(): SourceDefinition[] {
    return this.list().filter((definition) => definition.enabled);
  }

  createAdapter(source: string): JobSourceAdapter {
    const definition = this.get(source);
    if (!definition.enabled) {
      throw new Error(`Job source "${source}" is disabled.`);
    }
    const adapter = definition.createAdapter();
    if (adapter.source !== source) {
      throw new Error(
        `Adapter source mismatch: registered as "${source}" but adapter reports "${adapter.source}".`,
      );
    }
    return adapter;
  }
}

/** Shared process-wide registry. */
export const sourceRegistry = new SourceRegistry();
