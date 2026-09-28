/**
 * Phase 3 — Source wiring.
 *
 * To add a new source (e.g. Lever in Phase 4):
 *   1. Create `./leverAdapter.ts` implementing JobSourceAdapter.
 *   2. Register it below with its display name, type and policy URL.
 *   3. Seed its `external_job_sources` row via a migration.
 *
 * Importing this module registers every known source exactly once.
 */

import { sourceRegistry } from "../registry.js";
import { FixtureJobSource } from "./fixtureSource.js";
import { LEVER_DEFAULT_BASE_URL, LeverAdapter, parseLeverCompanies } from "./leverAdapter.js";
import {
  GREENHOUSE_DEFAULT_BASE_URL,
  GreenhouseAdapter,
  parseGreenhouseCompanies,
} from "./greenhouseAdapter.js";
import { ASHBY_DEFAULT_BASE_URL, AshbyAdapter, parseAshbyCompanies } from "./ashbyAdapter.js";

sourceRegistry.register({
  source: "fixture",
  displayName: "Fixture (local deterministic test source)",
  enabled: true,
  sourceType: "fixture",
  baseUrl: null,
  policyUrl: null,
  createAdapter: () => new FixtureJobSource(),
});

sourceRegistry.register({
  source: "lever",
  displayName: "Lever",
  enabled: true,
  sourceType: "api",
  baseUrl: LEVER_DEFAULT_BASE_URL,
  policyUrl: "https://www.lever.co/privacy/",
  createAdapter: () =>
    new LeverAdapter({ companies: parseLeverCompanies(process.env.LEVER_COMPANIES) }),
});

sourceRegistry.register({
  source: "greenhouse",
  displayName: "Greenhouse",
  enabled: true,
  sourceType: "api",
  baseUrl: GREENHOUSE_DEFAULT_BASE_URL,
  policyUrl: "https://www.greenhouse.io/privacy-policy",
  createAdapter: () =>
    new GreenhouseAdapter({
      companies: parseGreenhouseCompanies(process.env.GREENHOUSE_COMPANIES),
    }),
});

sourceRegistry.register({
  source: "ashby",
  displayName: "Ashby",
  enabled: true,
  sourceType: "api",
  baseUrl: ASHBY_DEFAULT_BASE_URL,
  policyUrl: "https://www.ashbyhq.com/privacy",
  createAdapter: () =>
    new AshbyAdapter({ companies: parseAshbyCompanies(process.env.ASHBY_COMPANIES) }),
});

export { sourceRegistry };
