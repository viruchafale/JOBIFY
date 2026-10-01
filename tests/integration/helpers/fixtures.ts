/**
 * Generated, synthetic test fixtures only — never real documents, per
 * docs/QA-AUDIT.md's explicit instruction not to upload real private
 * files in automated tests.
 */

/** A minimal but structurally valid PDF (correct header, trailer, EOF). */
export function validPdfBuffer(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n" +
      "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
      "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
      "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
      "trailer<</Root 1 0 R>>\n" +
      "%%EOF",
    "utf8",
  );
}

/** Oversized relative to the 5 MB limit enforced in uploadValidation.ts. */
export function oversizedPdfBuffer(): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.4\n", "utf8"), Buffer.alloc(6 * 1024 * 1024, "0")]);
}

/** Wrong type entirely — not a PDF by extension, mimetype, or content. */
export function plainTextBuffer(): Buffer {
  return Buffer.from("this is not a pdf\n", "utf8");
}

/** A minimal but structurally valid 1x1 PNG (correct magic bytes). */
export function validPngBuffer(): Buffer {
  return Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478" +
      "0163f8ffffff" +
      "3f0005fe02fea2f5f3cd0000000049454e44ae426082",
    "hex",
  );
}

/** Between the 2 MB assertImage limit and the 5 MB multer limit — exercises assertImage's own 413, not multer's. */
export function oversizedImageBuffer(): Buffer {
  const png = validPngBuffer();
  return Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024, 0)]);
}

let counter = 0;
/** Unique-per-run email so repeated test executions never collide on the real unique constraint. */
export function uniqueEmail(label: string): string {
  counter += 1;
  return `qa-${label}-${Date.now()}-${counter}@example.test`;
}
