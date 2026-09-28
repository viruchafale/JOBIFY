import path from "node:path";
import type { Express } from "express";
import ErrorHandler from "./errorHandler.js";

const isWebp = (buffer: Buffer) => buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
const isImage = (buffer: Buffer) => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])) || isWebp(buffer);

export function assertPdf(file: Express.Multer.File) {
  if (file.size > 5 * 1024 * 1024) throw new ErrorHandler(413, "Resume must not exceed 5 MB");
  if (path.extname(file.originalname).toLowerCase() !== ".pdf" || file.mimetype !== "application/pdf" || file.buffer.subarray(0, 5).toString() !== "%PDF-") throw new ErrorHandler(400, "Resume must be a valid PDF file");
}

export function assertImage(file: Express.Multer.File) {
  if (file.size > 2 * 1024 * 1024) throw new ErrorHandler(413, "Image must not exceed 2 MB");
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(file.originalname).toLowerCase()) || !["image/png", "image/jpeg", "image/webp"].includes(file.mimetype) || !isImage(file.buffer)) throw new ErrorHandler(400, "Image must be a valid PNG, JPEG, or WebP file");
}
