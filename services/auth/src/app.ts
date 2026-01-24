import express from "express";
import router from "./routes/auth.js";
import { connectKafka } from "./producer.js";

const app = express();

app.use((req, res, next) => {
  console.log(`📨 ${req.method} ${req.url}`);
  next();
});

app.use(express.json());
connectKafka();
app.use("/api/auth", router);

// error handler
app.use((err: any, req: any, res: any, next: any) => {
  res.status(err.status || 500).json({ message: err.message });
});

export default app;
