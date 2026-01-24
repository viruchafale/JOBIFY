import express from "express";
import { v2 as cloudinary } from "cloudinary";  // ✅ Use v2

const router = express.Router();

router.post("/upload", async (req, res) => {
  try {
    console.log("Upload request received:", req.body);
    const { buffer, public_id } = req.body;

    if (!buffer) {
      return res.status(400).json({ message: "Buffer is required" });
    }

    if (public_id) {
      await cloudinary.uploader.destroy(public_id);
    }

    const cloud = await cloudinary.uploader.upload(buffer, {
      resource_type: "auto"
    });

    res.json({
      url: cloud.secure_url,
      public_id: cloud.public_id
    });
  } catch (error: any) {
    console.error("Upload error:", error);
    res.status(500).json({
      message: error.message || "Upload failed"
    });
  }
});

export default router;