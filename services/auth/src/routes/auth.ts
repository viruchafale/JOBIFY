import express from "express";
import { forgetPassword, loginUser, logoutUser, registerUser, resetPassword } from "../controllers/auth.js";
import uploadFile from "../middleware/multer.js";
import { authRateLimits } from "../middleware/rateLimit.js";

const router = express.Router();

router.post("/register", authRateLimits.register, uploadFile, registerUser);
router.post("/login", authRateLimits.login, loginUser);
router.post("/logout", logoutUser);
router.post("/forgot", authRateLimits.forgot, forgetPassword)
router.post("/reset/:token", authRateLimits.reset, resetPassword)



export default router;
