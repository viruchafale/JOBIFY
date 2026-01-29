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
} from "../controller/jobs.js";

const router = express.Router();

router.post("/company/new", isAuth, uploadFile, createCompany);
router.delete("/company/:companyId", isAuth, deleteCompany);
router.post("/new", isAuth, createJob);
router.put("/update/:jobId", isAuth, updateJob);
router.get("/company/all",isAuth,getAllCompany)
router.get("/company/:id",isAuth,getCompanyDetails)
router.get("/all",getAllActiveJobs)
router.get("/:jobId",getSingleJobs)
router.get("/application/:jobId",isAuth,getAllApplicationForJOb)
router.put("/application/update/:id",isAuth,updateApplication)
export default router;
