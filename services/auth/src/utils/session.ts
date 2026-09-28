import { randomUUID } from "node:crypto";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import { redisClient } from "./redis.js";

const SESSION_COOKIE = "jobify_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;

function secret() {
  if (!process.env.SECRET_KEY) throw new Error("SECRET_KEY is required");
  return process.env.SECRET_KEY;
}

export async function createSession(userId: number) {
  const jti = randomUUID();
  await redisClient.set(`session:${jti}`, String(userId), { EX: SESSION_TTL_SECONDS });
  return jwt.sign({ sub: String(userId), jti, type: "session" }, secret(), { expiresIn: SESSION_TTL_SECONDS });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

export async function revokeSession(token?: string) {
  if (!token) return;
  try {
    const decoded = jwt.verify(token, secret()) as jwt.JwtPayload;
    if (decoded.type === "session" && typeof decoded.jti === "string") {
      await redisClient.del(`session:${decoded.jti}`);
    }
  } catch {
    // Clearing an expired or malformed cookie is still a successful logout.
  }
}

export const sessionCookieName = SESSION_COOKIE;
