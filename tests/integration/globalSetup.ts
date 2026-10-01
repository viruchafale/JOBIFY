import { startCloudinaryStub } from "./helpers/cloudinaryStub.js";

// Shared across every test file in this run (not a per-file beforeAll) —
// upload.resume.test.ts isn't the only file that exercises the upload
// path; auth.registration.test.ts's jobseeker test does too, and both
// need the same stub alive regardless of which file vitest runs first.
const CLOUDINARY_STUB_PORT = 41234;

export default async function setup() {
  const stub = await startCloudinaryStub(CLOUDINARY_STUB_PORT);
  return async () => {
    await stub.close();
  };
}
