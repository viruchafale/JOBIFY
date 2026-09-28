import { describe, it, expect } from "vitest";
import { extractEducation } from "./education.js";

describe("extractEducation", () => {
  it("extracts 'bachelor' from \"Bachelor's degree\"", () => {
    expect(extractEducation("A Bachelor's degree in Computer Science is required.").level).toBe("bachelor");
  });

  it("extracts 'master'", () => {
    expect(extractEducation("Master's degree preferred.").level).toBe("master");
  });

  it("extracts 'phd'", () => {
    expect(extractEducation("PhD in a related field.").level).toBe("phd");
  });

  it("extracts 'none' from explicit no-degree wording", () => {
    expect(extractEducation("No degree required — we care about what you can do.").level).toBe("none");
  });

  it("extracts 'bootcamp'", () => {
    expect(extractEducation("Bootcamp graduates welcome to apply.").level).toBe("bootcamp");
  });

  it("returns 'unspecified' when no education requirement is mentioned", () => {
    expect(extractEducation("We build great products for great people.").level).toBe("unspecified");
  });

  it("does not infer a degree requirement from company reputation or role alone", () => {
    // No explicit education wording anywhere in this text.
    expect(extractEducation("Join our world-class engineering team to build scalable systems.").level).toBe(
      "unspecified",
    );
  });

  it("returns 'unspecified' for a null description", () => {
    expect(extractEducation(null).level).toBe("unspecified");
  });

  it("keeps evidence short", () => {
    const longText = "x".repeat(500) + " Bachelor's degree in Computer Science " + "y".repeat(500);
    const result = extractEducation(longText);
    expect(result.evidence!.length).toBeLessThan(250);
  });
});
