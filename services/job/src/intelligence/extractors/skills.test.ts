import { describe, it, expect } from "vitest";
import { matchSkills, type SkillTaxonomyEntry } from "./skills.js";

const TAXONOMY: SkillTaxonomyEntry[] = [
  { skillId: 1, canonicalName: "Go", category: "programming_language", skillType: "technical", aliases: [
    { alias: "Go", caseSensitive: true },
    { alias: "Golang", caseSensitive: false },
  ] },
  { skillId: 2, canonicalName: "PostgreSQL", category: "database", skillType: "technical", aliases: [
    { alias: "PostgreSQL", caseSensitive: false },
    { alias: "Postgres", caseSensitive: false },
  ] },
  { skillId: 3, canonicalName: "Kubernetes", category: "devops", skillType: "technical", aliases: [
    { alias: "Kubernetes", caseSensitive: false },
    { alias: "K8s", caseSensitive: true },
  ] },
  { skillId: 4, canonicalName: "REST", category: "architecture", skillType: "technical", aliases: [
    { alias: "REST", caseSensitive: true },
  ] },
];

function match(description: string) {
  return matchSkills({ description, responsibilities: [], requirements: [] }, TAXONOMY);
}

describe("matchSkills — normalization / aliases", () => {
  it("matches 'Postgres', 'PostgreSQL', and 'postgres' to the same canonical skill", () => {
    expect(match("We use Postgres for storage.").map((s) => s.canonicalName)).toEqual(["PostgreSQL"]);
    expect(match("We use PostgreSQL for storage.").map((s) => s.canonicalName)).toEqual(["PostgreSQL"]);
    expect(match("We use postgres for storage.").map((s) => s.canonicalName)).toEqual(["PostgreSQL"]);
  });

  it("matches case-insensitively for unambiguous multi-character names", () => {
    expect(match("we run everything on kubernetes").map((s) => s.canonicalName)).toEqual(["Kubernetes"]);
    expect(match("we run everything on KUBERNETES").map((s) => s.canonicalName)).toEqual(["Kubernetes"]);
  });

  it("matches the 'Golang' alias to the canonical 'Go' skill", () => {
    expect(match("Experience with Golang required.").map((s) => s.canonicalName)).toEqual(["Go"]);
  });
});

describe("matchSkills — false-positive control", () => {
  it("does NOT match bare lowercase 'go' as the Go programming language in ordinary prose", () => {
    const result = match("We are excited to go the extra mile for our customers, and we go above and beyond.");
    expect(result.map((s) => s.canonicalName)).not.toContain("Go");
  });

  it("DOES match capitalized 'Go' as the programming language", () => {
    const result = match("We are hiring engineers who write Go every day.");
    expect(result.map((s) => s.canonicalName)).toContain("Go");
  });

  it("does not match 'go' inside a longer word (word-boundary correctness)", () => {
    const result = match("Our goal is to build a great product. We are going places.");
    expect(result.map((s) => s.canonicalName)).not.toContain("Go");
  });

  it("does not match bare lowercase 'rest' (as in 'the rest of the team') as the REST architecture style", () => {
    const result = match("The rest of the team will onboard you next week.");
    expect(result.map((s) => s.canonicalName)).not.toContain("REST");
  });

  it("DOES match all-caps 'REST' as the architecture style", () => {
    const result = match("Design and build REST APIs for our platform.");
    expect(result.map((s) => s.canonicalName)).toContain("REST");
  });

  it("does not match 'k8s' in lowercase (case-sensitive alias) but does match 'K8s'", () => {
    expect(match("we love k8s here").map((s) => s.canonicalName)).not.toContain("Kubernetes");
    expect(match("we love K8s here").map((s) => s.canonicalName)).toContain("Kubernetes");
  });
});

describe("matchSkills — requirement level derived from source, not presence alone", () => {
  it("marks a skill 'required' only when it's found inside a job_requirements item with level=required", () => {
    const result = matchSkills(
      {
        description: "We build things with Go and Postgres.",
        responsibilities: [],
        requirements: [{ position: 0, text: "3+ years of Go experience.", requirementLevel: "required", source: "deterministic", confidence: null }],
      },
      TAXONOMY,
    );
    const go = result.find((s) => s.canonicalName === "Go");
    const postgres = result.find((s) => s.canonicalName === "PostgreSQL");
    expect(go?.requirementLevel).toBe("required");
    expect(postgres?.requirementLevel).toBe("mentioned"); // only in the general description, not a requirement item
  });

  it("marks a skill 'preferred' when found in a preferred-level requirement item", () => {
    const result = matchSkills(
      {
        description: null,
        responsibilities: [],
        requirements: [{ position: 0, text: "Kubernetes experience is a bonus.", requirementLevel: "preferred", source: "deterministic", confidence: null }],
      },
      TAXONOMY,
    );
    expect(result.find((s) => s.canonicalName === "Kubernetes")?.requirementLevel).toBe("preferred");
  });

  it("does not mark a skill required merely because it's mentioned in the description", () => {
    const result = match("Our stack includes Go, PostgreSQL, and Kubernetes.");
    for (const skill of result) {
      expect(skill.requirementLevel).toBe("mentioned");
    }
  });

  it("takes the strongest signal when a skill appears both as 'mentioned' and 'required'", () => {
    const result = matchSkills(
      {
        description: "Our stack includes Go everywhere.",
        responsibilities: [],
        requirements: [{ position: 0, text: "Go experience required.", requirementLevel: "required", source: "deterministic", confidence: null }],
      },
      TAXONOMY,
    );
    expect(result.find((s) => s.canonicalName === "Go")?.requirementLevel).toBe("required");
  });
});

describe("matchSkills — evidence and confidence", () => {
  it("attaches a short evidence snippet from the source text", () => {
    const result = match("We are looking for engineers with strong PostgreSQL experience for our platform.");
    const postgres = result.find((s) => s.canonicalName === "PostgreSQL");
    expect(postgres?.evidence).toContain("PostgreSQL");
    expect(postgres?.evidence!.length).toBeLessThan(210);
  });

  it("never invents evidence when there is no match", () => {
    const result = match("We build great products.");
    expect(result).toEqual([]);
  });

  it("has null confidence for every deterministic match", () => {
    const result = match("We use Go and PostgreSQL.");
    for (const skill of result) {
      expect(skill.source).toBe("deterministic");
      expect(skill.confidence).toBeNull();
    }
  });
});
