import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { redisClient } from "../redis.js";

export interface SessionRequest extends Request { sessionUserId?: number; }

export async function requireSession(req: SessionRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.jobify_session;
    if (!token) return res.status(401).json({ message: "Authentication is required" });
    const decoded = jwt.verify(token, process.env.SECRET_KEY as string) as jwt.JwtPayload;
    if (decoded.type !== "session" || typeof decoded.sub !== "string" || typeof decoded.jti !== "string") {
      return res.status(401).json({ message: "Invalid session" });
    }
    if (await redisClient.get(`session:${decoded.jti}`) !== decoded.sub) {
      return res.status(401).json({ message: "Session has expired or was revoked" });
    }
    req.sessionUserId = Number(decoded.sub);
    next();
  } catch {
    return res.status(401).json({ message: "Authentication failed" });
  }
}

export function requireInternalService(req: Request, res: Response, next: NextFunction) {
  if (!process.env.INTERNAL_SERVICE_KEY || req.header("x-internal-service-key") !== process.env.INTERNAL_SERVICE_KEY) {
    return res.status(403).json({ message: "Trusted internal service access is required" });
  }
  next();
}
