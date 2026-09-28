/**
 * Phase 3 — Fixture adapter + source registry tests.
 */

import { describe, it, expect } from "vitest";
import { FixtureJobSource } from "./sources/fixtureSource.js";
import { sourceRegistry } from "./sources/index.js";

describe("FixtureJobSource", () => {
  it("loads deterministic fixture jobs", async () => {
    const adapter = new FixtureJobSource();
    expect(adapter.source).toBe("fixture");
    const jobs = await adapter.fetchJobs();
    expect(jobs.length).toBe(16);
    for (const job of jobs) {
      expect(job.source).toBe("fixture");
      expect(job.rawPayload).toBeDefined();
    }
  });

  it("returns equal content on repeated fetches", async () => {
    const adapter = new FixtureJobSource();
    const first = await adapter.fetchJobs();
    const second = await adapter.fetchJobs();
    expect(second).toEqual(first);
  });

  it("contains malformed entries without throwing", async () => {
    const adapter = new FixtureJobSource();
    const jobs = await adapter.fetchJobs();
    const blankTitle = jobs.find((job) => job.sourceJobId === "fx-008");
    const blankDescription = jobs.find((job) => job.sourceJobId === "fx-009");
    const blankId = jobs.find((job) => job.sourceUrl?.includes("fx-010"));
    expect(blankTitle?.title?.trim()).toBe("");
    expect(blankDescription?.description?.trim()).toBe("");
    expect(blankId?.sourceJobId.trim()).toBe("");
  });

  it("throws a clear error for a missing fixture file", async () => {
    const adapter = new FixtureJobSource("/does/not/exist.json");
    await expect(adapter.fetchJobs()).rejects.toThrow(/fixture/i);
  });
});

describe("sourceRegistry", () => {
  it("knows the fixture source and creates its adapter", () => {
    const definition = sourceRegistry.get("fixture");
    expect(definition.displayName).toMatch(/fixture/i);
    expect(definition.enabled).toBe(true);
    const adapter = sourceRegistry.createAdapter("fixture");
    expect(adapter.source).toBe("fixture");
  });

  it("rejects unknown sources", () => {
    expect(() => sourceRegistry.get("unknown-source")).toThrow(/unknown job source/i);
  });

  it("knows the lever source and creates its adapter (Phase 4)", () => {
    const definition = sourceRegistry.get("lever");
    expect(definition.displayName).toMatch(/lever/i);
    expect(definition.sourceType).toBe("api");
    expect(definition.enabled).toBe(true);
    const adapter = sourceRegistry.createAdapter("lever");
    expect(adapter.source).toBe("lever");
  });

  it("knows the greenhouse source and creates its adapter (Phase 5)", () => {
    const definition = sourceRegistry.get("greenhouse");
    expect(definition.displayName).toMatch(/greenhouse/i);
    expect(definition.sourceType).toBe("api");
    expect(definition.enabled).toBe(true);
    const adapter = sourceRegistry.createAdapter("greenhouse");
    expect(adapter.source).toBe("greenhouse");
  });

  it("knows the ashby source and creates its adapter (Phase 5)", () => {
    const definition = sourceRegistry.get("ashby");
    expect(definition.displayName).toMatch(/ashby/i);
    expect(definition.sourceType).toBe("api");
    expect(definition.enabled).toBe(true);
    const adapter = sourceRegistry.createAdapter("ashby");
    expect(adapter.source).toBe("ashby");
  });

  it("lists all four registered sources", () => {
    const sources = sourceRegistry.list().map((d) => d.source).sort();
    expect(sources).toEqual(["ashby", "fixture", "greenhouse", "lever"]);
  });
});
