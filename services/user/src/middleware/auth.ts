import { Request, Response, NextFunction } from "express";
import jwt, { decode, JwtPayload } from "jsonwebtoken";
import { sql } from "../utils/db.js";
import { redisClient } from "../utils/redis.js";

interface User {
  user_id: number;
  name: string;
  email: string;
  phone_number: string;
  role: "jobseeker" | "recruiter";
  bio: string | null;
  resume: string | null;
  resume_public_id: string | null;
  profile_pic: string | null;
  profile_pic_public_id:string | null,
  skills: string[];
  subscription: string | null;
}


export interface AuthenticatedRequest extends Request{
  user?:User
}

export const isAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const token = req.cookies?.jobify_session;
    if (!token || typeof token !== "string") {
      res.status(401).json({
        message: "Authentication is required",
      });
      return;
    }
    const decodedPayLoad = jwt.verify(token, process.env.SECRET_KEY as string) as JwtPayload;

    if (!decodedPayLoad || decodedPayLoad.type !== "session" || !decodedPayLoad.sub || typeof decodedPayLoad.jti !== "string") {
      res.status(401).json({
        message: "Invalid Token"
      });
      return;
    }
    const sessionUserId = await redisClient.get(`session:${decodedPayLoad.jti}`);
    if (sessionUserId !== decodedPayLoad.sub) {
      res.status(401).json({ message: "Session has expired or was revoked" });
      return;
    }

   const users = await sql`
  SELECT 
    u.user_id,
    u.name,
    u.email,
    u.phone_number,
    u.role,
    u.bio,
    u.resume,
    u.resume_public_id,
    u.profile_pic,
    u.subscription,
    ARRAY_AGG(s.name) FILTER (WHERE s.name IS NOT NULL) AS skills
  FROM users u
  LEFT JOIN user_skills us ON u.user_id = us.user_id
  LEFT JOIN skills s ON us.skill_id = s.skill_id
  WHERE u.user_id = ${Number(decodedPayLoad.sub)}
  GROUP BY u.user_id
`;

    if (users.length === 0) {
      res.status(401).json({
        message: "User associated with this token no longer exists."
      });
      return;
    }
    const user = users[0] as unknown as User;
    user.skills = user.skills || [];
    req.user = user;
    next();


  } catch (error) {
    console.log(error);
    res.status(401).json({
      message: "Authentication Failed. Please Login again"
    });
  }
};


