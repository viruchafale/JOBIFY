import jwt from "jsonwebtoken";
import { sql } from "../utils/db.js";
export const isAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith("Bearer")) {
            res.status(401).json({
                message: "Authorization header is missing or invalid ",
            });
            return;
        }
        const token = authHeader.split(" ")[1];
        const decodedPayLoad = jwt.verify(token, process.env.SECRET_KEY);
        if (!decodedPayLoad || !decodedPayLoad.id) {
            res.status(401).json({
                message: "Invalid Token"
            });
            return;
        }
        const users = await sql `
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
  WHERE u.user_id = ${decodedPayLoad.id}
  GROUP BY u.user_id
`;
        if (users.length === 0) {
            res.status(401).json({
                message: "User associated with this token no longer exists."
            });
            return;
        }
        const user = users[0];
        user.skills = user.skills || [];
        req.user = user;
        next();
    }
    catch (error) {
        console.log(error);
        res.status(401).json({
            message: "Authentication Failed. Please Login again"
        });
    }
};
