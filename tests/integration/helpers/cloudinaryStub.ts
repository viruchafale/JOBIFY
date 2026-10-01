import https from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A minimal stand-in for Cloudinary's upload API — not a mock of
 * UPLOAD_SERVICE or INTERNAL_SERVICE_KEY (both stay completely real;
 * that's the exact boundary P0.1 broke). This only replaces the actual
 * third-party cloud call utils-service makes *after* clearing that
 * boundary, because no real Cloudinary account is available in this
 * environment. It doesn't validate Cloudinary's protocol — it just
 * proves a request arrived and returns a plausibly-shaped response, so
 * the full register -> upload -> stored-resume workflow can be verified
 * without depending on a real external account.
 *
 * utils-service is pointed at this via CLOUDINARY_UPLOAD_PREFIX, which
 * defaults to the real "https://api.cloudinary.com" in every other
 * context (see services/utils/src/index.ts) — this is the one place
 * that env var is ever overridden.
 *
 * Uses real (self-signed) TLS, not plain HTTP: the Cloudinary SDK
 * decides which Node module (`http` vs `https`) to use once, at
 * `require("cloudinary")` time — before any of our runtime config ever
 * runs — and defaults to `https` whenever no http:-prefixed
 * upload_prefix was already present at that point, which is always true
 * here. A plain-HTTP stub gets a hard `ERR_INVALID_PROTOCOL` from
 * Node's own https client; a self-signed HTTPS one works, as long as
 * the caller also sets NODE_TLS_REJECT_UNAUTHORIZED=0 (test-only — see
 * README.md) so Node doesn't reject the self-signed cert.
 */
export function startCloudinaryStub(port: number): Promise<{ close: () => Promise<void> }> {
  const { key, cert } = generateSelfSignedCert();

  return new Promise((resolve, reject) => {
    const server = https.createServer({ key, cert }, (req, res) => {
      req.resume();
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.url?.includes("/destroy")) {
          res.end(JSON.stringify({ result: "ok" }));
          return;
        }
        res.end(
          JSON.stringify({
            secure_url: `https://stub.test/${Date.now()}-fake-resume.pdf`,
            public_id: `stub_${Date.now()}`,
          }),
        );
      });
    });
    server.on("error", reject);
    server.listen(port, "0.0.0.0", () =>
      resolve({
        close: () => new Promise((r) => server.close(() => r())),
      }),
    );
  });
}

/** Generates a throwaway self-signed cert via the system `openssl` CLI — not committed, not reused across runs. */
function generateSelfSignedCert(): { key: string; cert: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "jobify-cloudinary-stub-"));
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath,
    "-days", "1", "-nodes", "-subj", "/CN=localhost",
  ]);
  return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
}
