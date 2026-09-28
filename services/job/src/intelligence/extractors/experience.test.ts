import { describe, it, expect } from "vitest";
import { extractExperience } from "./experience.js";

describe("extractExperience", () => {
  it("extracts '3+ years'", () => {
    const result = extractExperience("We need 3+ years of backend experience.");
    expect(result.minYears).toBe(3);
    expect(result.maxYears).toBeNull();
    expect(result.evidence).toContain("3+ years");
  });

  it("extracts '5 years' as an exact figure", () => {
    const result = extractExperience("Candidates should have 5 years of experience.");
    expect(result.minYears).toBe(5);
    expect(result.maxYears).toBe(5);
  });

  it("extracts '2-4 years' as a range", () => {
    const result = extractExperience("2-4 years of relevant experience required.");
    expect(result.minYears).toBe(2);
    expect(result.maxYears).toBe(4);
  });

  it("extracts 'at least 5 years'", () => {
    const result = extractExperience("You have at least 5 years in distributed systems.");
    expect(result.minYears).toBe(5);
    expect(result.maxYears).toBeNull();
  });

  it("extracts 'minimum of 3 years'", () => {
    const result = extractExperience("A minimum of 3 years of professional experience.");
    expect(result.minYears).toBe(3);
  });

  it("does not invent experience from a seniority title alone", () => {
    const result = extractExperience("We are hiring a Senior Backend Engineer to join the team.");
    expect(result.minYears).toBeNull();
    expect(result.maxYears).toBeNull();
    expect(result.evidence).toBeNull();
  });

  it("returns null for a null description", () => {
    expect(extractExperience(null)).toEqual({ minYears: null, maxYears: null, evidence: null });
  });

  it("returns null when no experience statement is present", () => {
    const result = extractExperience("We build great software for great people.");
    expect(result.minYears).toBeNull();
  });

  it("keeps evidence short (bounded snippet, not the whole description)", () => {
    const longText = "x".repeat(500) + " 3+ years of experience " + "y".repeat(500);
    const result = extractExperience(longText);
    expect(result.evidence).not.toBeNull();
    expect(result.evidence!.length).toBeLessThan(250);
  });

  it("prefers a range match over a looser bare-number match", () => {
    const result = extractExperience("3-5 years of experience required.");
    expect(result.minYears).toBe(3);
    expect(result.maxYears).toBe(5);
  });

  it("does not match company/team history phrased as 'N+ years ago' (real false positive found via live-data verification)", () => {
    const result = extractExperience(
      "Our team was formed 15+ years ago as a rejection of the prevailing view. We are now hiring a new grad engineer.",
    );
    expect(result.minYears).toBeNull();
  });

  it("does not match an age reference phrased as 'N years old'", () => {
    const result = extractExperience("The company is proud to be 5 years old this year.");
    expect(result.minYears).toBeNull();
  });

  it("scans preferredTexts (structured requirement items) before the general description", () => {
    const description = "Our team was formed 15+ years ago. " + "x".repeat(50);
    const result = extractExperience(description, ["3+ years of Go experience required."]);
    expect(result.minYears).toBe(3);
    expect(result.evidence).toContain("3+ years");
  });

  it("falls back to the description when no preferredTexts match", () => {
    const result = extractExperience("5 years of experience required.", ["No numbers in this requirement."]);
    expect(result.minYears).toBe(5);
  });
});
