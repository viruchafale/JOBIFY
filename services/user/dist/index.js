import express from "express";
import dotenv from "dotenv";
dotenv.config();
const app = express();
app.listen(process.env.PORT, () => {
    console.log(`User services is running on http://localhost :${process.env.PORT}`);
});
