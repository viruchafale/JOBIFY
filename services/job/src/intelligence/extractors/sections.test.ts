import { describe, it, expect } from "vitest";
import {
  extractSectionsFromHtml,
  extractSectionsFromLeverLists,
  extractSectionsFromRawPayload,
} from "./sections.js";

describe("extractSectionsFromHtml", () => {
  it("keeps responsibilities and requirements separate (spec's canonical example)", () => {
    const html = `
      <h3>Responsibilities</h3>
      <ul><li>Build distributed systems.</li></ul>
      <h3>Requirements</h3>
      <ul><li>3+ years of Go experience.</li></ul>
    `;
    const result = extractSectionsFromHtml(html);
    expect(result.responsibilities).toHaveLength(1);
    expect(result.responsibilities[0].text).toBe("Build distributed systems.");
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].text).toBe("3+ years of Go experience.");
    expect(result.requirements[0].requirementLevel).toBe("required");
  });

  it("recognizes 'What you'll do' / 'What you'll bring' headings", () => {
    const html = `
      <p>What you'll do</p>
      <ul><li>Design APIs.</li><li>Review code.</li></ul>
      <p>What you'll bring</p>
      <ul><li>Experience with PostgreSQL.</li></ul>
    `;
    const result = extractSectionsFromHtml(html);
    expect(result.responsibilities.map((r) => r.text)).toEqual(["Design APIs.", "Review code."]);
    expect(result.requirements.map((r) => r.text)).toEqual(["Experience with PostgreSQL."]);
  });

  it("classifies a 'preferred'/'nice to have' section separately from required", () => {
    const html = `
      <p>Requirements</p>
      <ul><li>Go experience.</li></ul>
      <p>Nice to have</p>
      <ul><li>Kubernetes experience.</li></ul>
    `;
    const result = extractSectionsFromHtml(html);
    expect(result.requirements.find((r) => r.text === "Go experience.")?.requirementLevel).toBe("required");
    expect(result.requirements.find((r) => r.text === "Kubernetes experience.")?.requirementLevel).toBe("preferred");
  });

  it("preserves item order via position", () => {
    const html = `<p>Requirements</p><ul><li>First.</li><li>Second.</li><li>Third.</li></ul>`;
    const result = extractSectionsFromHtml(html);
    expect(result.requirements.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(result.requirements.map((r) => r.text)).toEqual(["First.", "Second.", "Third."]);
  });

  it("returns empty arrays when no recognizable section heading exists", () => {
    const html = `<p>We are a great company doing great things for great people.</p>`;
    const result = extractSectionsFromHtml(html);
    expect(result.responsibilities).toEqual([]);
    expect(result.requirements).toEqual([]);
  });

  it("returns empty arrays for null/empty input", () => {
    expect(extractSectionsFromHtml(null)).toEqual({ responsibilities: [], requirements: [] });
    expect(extractSectionsFromHtml("")).toEqual({ responsibilities: [], requirements: [] });
  });

  it("does not misclassify a long sentence that merely mentions 'requirements' mid-paragraph as a heading", () => {
    const html = `
      <p>Responsibilities</p>
      <ul><li>Understand business requirements and translate them into technical designs for the team.</li></ul>
    `;
    const result = extractSectionsFromHtml(html);
    // The <li> item itself mentions "requirements" but is a responsibility bullet, not a new heading.
    expect(result.responsibilities).toHaveLength(1);
    expect(result.requirements).toEqual([]);
  });

  it("recognizes 'What We Require' as a requirements heading (real Lever heading found via live-data verification)", () => {
    const html = `<p>What We Require</p><ul><li>Active security clearance.</li></ul>`;
    const result = extractSectionsFromHtml(html);
    expect(result.requirements.map((r) => r.text)).toEqual(["Active security clearance."]);
  });

  it("recognizes 'What We Value' as a preferred heading (real Lever heading found via live-data verification)", () => {
    const html = `<p>What We Value</p><ul><li>Curiosity and grit.</li></ul>`;
    const result = extractSectionsFromHtml(html);
    expect(result.requirements.find((r) => r.text === "Curiosity and grit.")?.requirementLevel).toBe("preferred");
  });

  it("decodes HTML entities in item text", () => {
    const html = `<p>Requirements</p><ul><li>Experience with Node &amp; Express.</li></ul>`;
    const result = extractSectionsFromHtml(html);
    expect(result.requirements[0].text).toBe("Experience with Node & Express.");
  });

  it("handles Greenhouse-style double-escaped content once unescaped by the adapter layer", () => {
    // sections.ts itself only decodes single-level entities (Greenhouse's
    // double-escaping is undone by greenhouseAdapter.ts before storage).
    const html = `<div><strong>Requirements</strong></div><ul><li>5+ years of experience.</li></ul>`;
    const result = extractSectionsFromHtml(html);
    expect(result.requirements[0].text).toBe("5+ years of experience.");
  });

  it("caps the number of items collected", () => {
    const items = Array.from({ length: 30 }, (_, i) => `<li>Item ${i}</li>`).join("");
    const html = `<p>Requirements</p><ul>${items}</ul>`;
    const result = extractSectionsFromHtml(html);
    expect(result.requirements.length).toBeLessThanOrEqual(20);
  });
});

describe("extractSectionsFromLeverLists", () => {
  it("uses the heading to classify each list block", () => {
    const lists = [
      { text: "Responsibilities", content: "<li>Build things.</li>" },
      { text: "Requirements", content: "<li>3+ years of Go.</li>" },
    ];
    const result = extractSectionsFromLeverLists(lists);
    expect(result.responsibilities.map((r) => r.text)).toEqual(["Build things."]);
    expect(result.requirements.map((r) => r.text)).toEqual(["3+ years of Go."]);
  });

  it("defaults an unlabeled Lever list block to responsibilities (documented Lever-specific convention)", () => {
    const lists = [{ text: "Administrative Business Partner", content: "<li>Handle calendars.</li>" }];
    const result = extractSectionsFromLeverLists(lists);
    expect(result.responsibilities.map((r) => r.text)).toEqual(["Handle calendars."]);
  });

  it("returns empty arrays for a non-array input", () => {
    expect(extractSectionsFromLeverLists(null)).toEqual({ responsibilities: [], requirements: [] });
    expect(extractSectionsFromLeverLists(undefined)).toEqual({ responsibilities: [], requirements: [] });
  });
});

describe("extractSectionsFromRawPayload", () => {
  it("uses Lever's lists field for source='lever'", () => {
    const rawPayload = { lists: [{ text: "Requirements", content: "<li>Go experience.</li>" }] };
    const result = extractSectionsFromRawPayload("lever", rawPayload);
    expect(result.requirements.map((r) => r.text)).toEqual(["Go experience."]);
  });

  it("uses Greenhouse's content field for source='greenhouse'", () => {
    const rawPayload = { content: "<p>Requirements</p><ul><li>PostgreSQL experience.</li></ul>" };
    const result = extractSectionsFromRawPayload("greenhouse", rawPayload);
    expect(result.requirements.map((r) => r.text)).toEqual(["PostgreSQL experience."]);
  });

  it("uses Ashby's descriptionHtml field for source='ashby'", () => {
    const rawPayload = { descriptionHtml: "<p>Requirements</p><ul><li>Kubernetes experience.</li></ul>" };
    const result = extractSectionsFromRawPayload("ashby", rawPayload);
    expect(result.requirements.map((r) => r.text)).toEqual(["Kubernetes experience."]);
  });

  it("returns empty arrays for a malformed/missing raw payload", () => {
    expect(extractSectionsFromRawPayload("lever", null)).toEqual({ responsibilities: [], requirements: [] });
    expect(extractSectionsFromRawPayload("lever", "not an object")).toEqual({ responsibilities: [], requirements: [] });
  });
});
