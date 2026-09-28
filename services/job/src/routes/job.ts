import express from "express";
import { isAuth } from "../middleware/auth.js";
import uploadFile from "../middleware/multer.js";
import {
  createCompany,
  createJob,
  deleteCompany,
  getAllActiveJobs,
  getAllApplicationForJOb,
  getAllCompany,
  getCompanyDetails,
  getSingleJobs,
  updateApplication,
  updateJob,
  applyJob,
} from "../controller/jobs.js";
import {
  getExternalJobByIdHandler,
  listExternalJobsHandler,
  searchExternalJobsHandler,
} from "../controller/externalJobs.js";
import { getJobIntelligenceHandler } from "../controller/intelligence.js";
import { applicationSubmissionLimit, searchLimit, uploadLimit } from "../middleware/rateLimit.js";

const router = express.Router();

router.post("/company/new", isAuth, uploadLimit, uploadFile, createCompany);
router.delete("/company/:companyId", isAuth, deleteCompany);
router.post("/new", isAuth, createJob);
router.put("/update/:jobId", isAuth, updateJob);
router.get("/company/all",isAuth,getAllCompany)
router.get("/company/:id",isAuth,getCompanyDetails)
router.get("/application/:jobId",isAuth,getAllApplicationForJOb)
router.put("/application/update/:id",isAuth,updateApplication)
router.post("/apply/:jobId", isAuth, applicationSubmissionLimit, uploadFile, applyJob);
router.get("/all",getAllActiveJobs)
// Phase 3 — external (ingested) jobs. Must stay above "/:jobId".
// Phase 7 — "/external/search" must stay above "/external/:id", otherwise
// Express would match "search" as the :id parameter.
router.get("/external/search",searchLimit,searchExternalJobsHandler)
router.get("/external",listExternalJobsHandler)
router.get("/external/:id",getExternalJobByIdHandler)
// Phase 8 — read-only, derived job intelligence for one external job.
router.get("/external/:id/intelligence",getJobIntelligenceHandler)
router.get("/:jobId",getSingleJobs)
export default router;
