import express from "express";
import dotenv from "dotenv";
import jobRoutes from "./routes/job.js";
dotenv.config();
const app = express();
app.use(express.json());
app.use("/api/job", jobRoutes);
export default app;
