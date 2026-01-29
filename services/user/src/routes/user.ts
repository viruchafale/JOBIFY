import express from "express";
import { isAuth } from "../middleware/auth";
import {
  addSkillToUser,
  applyForJob,
  deleteSkillFromUser,
  getAllApplications,
  getUserProfile,
  myProfile,
  updateProfilePic,
  updateResume,
  updateUserProfile,
} from "../controller/user";
import uploadFile from "../middleware/multer";
const router = express.Router();

router.get("/me", isAuth, myProfile);
router.get("/:userId", isAuth, getUserProfile);
router.put("/update/profile", isAuth, updateUserProfile);
router.put("/update/pic", isAuth, uploadFile, updateProfilePic);
router.put("/update/resume", isAuth, uploadFile, updateResume);
router.post("/skill/add",isAuth,addSkillToUser)
router.delete("/skill/delete",isAuth,deleteSkillFromUser)

router.post("/apply/job",isAuth,applyForJob)
router.get("/application/all",isAuth,getAllApplications)



export default router;
