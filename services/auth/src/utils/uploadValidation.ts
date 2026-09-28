import path from "node:path";
import type { Express } from "express";
import ErrorHandler from "./errorHandler.js";

export function assertPdf(file: Express.Multer.File) {
  if (file.size > 5 * 1024 * 1024) throw new ErrorHandler(413, "Resume must not exceed 5 MB");
  if (path.extname(file.originalname).toLowerCase() !== ".pdf" || file.mimetype !== "application/pdf" || file.buffer.subarray(0, 5).toString() !== "%PDF-") {
    throw new ErrorHandler(400, "Resume must be a valid PDF file");
  }
}
