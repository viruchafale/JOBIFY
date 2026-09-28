import express from "express";
import { isAuth } from "../middleware/auth.js";
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
} from "../controller/user.js";
import uploadFile from "../middleware/multer.js";
import { uploadLimit } from "../middleware/rateLimit.js";
const router = express.Router();

router.get("/me", isAuth, myProfile);
router.put("/update/profile", isAuth, updateUserProfile);
router.put("/update/pic", isAuth, uploadLimit, uploadFile, updateProfilePic);
router.put("/update/resume", isAuth, uploadLimit, uploadFile, updateResume);
router.post("/skill/add", isAuth, addSkillToUser);
router.delete("/skill/delete", isAuth, deleteSkillFromUser);
router.post("/apply/job", isAuth, applyForJob);
// NOTE: /application/all must come before /:userId to avoid being caught by the wildcard
router.get("/application/all", isAuth, getAllApplications);
router.get("/:userId", isAuth, getUserProfile);

export default router;
