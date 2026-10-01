import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Generated, synthetic test fixtures only — never real documents, per
 * docs/QA-AUDIT.md's explicit instruction. Written to a temp file since
 * Playwright's setInputFiles needs a real path, not a Buffer.
 */
export function writeValidPdfFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "jobify-e2e-"));
  const filePath = path.join(dir, "resume.pdf");
  writeFileSync(
    filePath,
    "%PDF-1.4\n" +
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
      "trailer<</Root 1 0 R>>\n" +
      "%%EOF",
    "utf8",
  );
  return filePath;
}

let counter = 0;
export function uniqueEmail(label: string): string {
  counter += 1;
  return `qa-e2e-${label}-${Date.now()}-${counter}@example.test`;
}
