// import express from "express";
// import { registerUser } from "../controllers/auth.js";
// import uploadFile from "../middleware/multer.js";

// const router=express.Router()

// router.post("/register",uploadFile, registerUser)
// export default router


import express from "express";
import { registerUser } from "../controllers/auth.js";
import uploadFile from "../middleware/multer.js";

const router = express.Router();

// Add test route
router.get("/test", (req, res) => {
  console.log("Test route hit");
  res.json({ message: "Auth routes working!" });
});

router.post("/register", uploadFile, registerUser);

export default router;