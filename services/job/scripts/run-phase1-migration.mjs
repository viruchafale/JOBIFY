import fs from "node:fs/promises";
import process from "node:process";
import { neon } from "@neondatabase/serverless";

if (!process.env.DB_URL) {
  throw new Error("DB_URL is required; the Phase 1 migration was not run.");
}

const sql = neon(process.env.DB_URL);
const [unmatched, duplicate, orphanCompanies, orphanJobs] = await Promise.all([
  sql`SELECT application_id, applicant_email, job_id FROM applications a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(a.applicant_email)) ORDER BY application_id`,
  sql`SELECT job_id, lower(applicant_email) AS applicant_email, count(*)::int AS count FROM applications GROUP BY job_id, lower(applicant_email) HAVING count(*) > 1`,
  sql`SELECT company_id, recruiter_id FROM companies c WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = c.recruiter_id) ORDER BY company_id`,
  sql`SELECT job_id, posted_by_recruiter_id FROM jobs j WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.user_id = j.posted_by_recruiter_id) ORDER BY job_id`,
]);

const report = { unmatchedApplications: unmatched, duplicateApplications: duplicate, orphanCompanies, orphanJobs };
console.table({
  unmatchedApplications: unmatched.length,
  duplicateApplications: duplicate.length,
  orphanCompanies: orphanCompanies.length,
  orphanJobs: orphanJobs.length,
});

if (unmatched.length || duplicate.length || orphanCompanies.length || orphanJobs.length) {
  console.error(JSON.stringify(report, null, 2));
  throw new Error("Migration safety boundary reached; no schema constraints were changed.");
}

const migration = await fs.readFile(new URL("../migrations/001_phase1_application_integrity.sql", import.meta.url), "utf8");
await sql.query(migration);
console.log("Phase 1 migration applied successfully.");
