import express from "express";
import router from "./routes/auth.js";
const app = express();

app.use(express.json())
app.use("/api/auth",router)

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.status(err.status || 500).json({ message: err.message });
});

export default app;

// import express from "express";
// import router from "./routes/auth.js";
// import cors from "cors";

// const app = express();
// app.use(cors())

// // Add logging middleware FIRST
// app.use((req, res, next) => {
//   console.log(`📨 ${req.method} ${req.url}`);
//   next();
// });

// app.use(express.json());
// app.use("/api/auth", router);

// app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
//   console.error("Error:", err);
//   res.status(err.status || 500).json({ message: err.message });
// });

// export default app;