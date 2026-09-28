import { describe, it, expect } from "vitest";
import { extractSeniority } from "./seniority.js";

describe("extractSeniority", () => {
  it("extracts 'senior' from a title", () => {
    expect(extractSeniority("Senior Backend Engineer").seniority).toBe("senior");
  });

  it("extracts 'staff'", () => {
    expect(extractSeniority("Staff Software Engineer").seniority).toBe("staff");
  });

  it("extracts 'intern'", () => {
    expect(extractSeniority("Software Engineering Intern").seniority).toBe("intern");
  });

  it("extracts 'principal'", () => {
    expect(extractSeniority("Principal Engineer, Platform").seniority).toBe("principal");
  });

  it("extracts 'lead'", () => {
    expect(extractSeniority("Tech Lead, Payments").seniority).toBe("lead");
  });

  it("extracts 'manager'", () => {
    expect(extractSeniority("Engineering Manager").seniority).toBe("manager");
  });

  it("extracts 'director'", () => {
    expect(extractSeniority("Director of Engineering").seniority).toBe("director");
  });

  it("extracts 'executive' from VP/Chief titles", () => {
    expect(extractSeniority("VP of Engineering").seniority).toBe("executive");
    expect(extractSeniority("Chief Technology Officer").seniority).toBe("executive");
  });

  it("extracts 'junior'", () => {
    expect(extractSeniority("Junior Developer").seniority).toBe("junior");
  });

  it("extracts 'mid' from intermediate/mid-level", () => {
    expect(extractSeniority("Mid-level Software Engineer").seniority).toBe("mid");
  });

  it("resolves 'Senior Staff Engineer' to 'staff' (most-senior-first priority)", () => {
    expect(extractSeniority("Senior Staff Engineer").seniority).toBe("staff");
  });

  it("returns 'unknown' for an unlabeled title rather than guessing", () => {
    expect(extractSeniority("Software Engineer").seniority).toBe("unknown");
  });

  it("returns 'unknown' for a null title", () => {
    expect(extractSeniority(null).seniority).toBe("unknown");
  });

  it("preserves the source title phrase as evidence", () => {
    const result = extractSeniority("Senior Backend Engineer");
    expect(result.evidence).toBe("Senior Backend Engineer");
  });

  it("does not have null evidence when unknown", () => {
    expect(extractSeniority("Software Engineer").evidence).toBeNull();
  });
});
