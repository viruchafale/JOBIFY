/**
 * Phase 3 — Deterministic content fingerprinting (SHA-256, no AI/embeddings).
 *
 * The fingerprint is computed over NORMALIZED (company, title, description,
 * location). Callers must pass already-normalized values (lowercasing happens
 * here as a final guard). Level-3 dedupe identity.
 */

import { createHash } from "node:crypto";

export interface FingerprintInput {
  companyName: string;
  title: string;
  description: string;
  location: string;
}

function canonicalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function computeContentFingerprint(input: FingerprintInput): string {
  const canonical = [
    canonicalize(input.companyName),
    canonicalize(input.title),
    canonicalize(input.description),
    canonicalize(input.location),
  ].join("");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
