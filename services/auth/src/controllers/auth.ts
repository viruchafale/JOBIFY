import getBuffer from "../utils/buffer.js";
import { sql } from "../utils/db.js";
import ErrorHandler from "../utils/errorHandler.js";
import { TryCatch } from "../utils/TryCatch.js";
import bcrypt from "bcrypt";
import axios from "axios";
import jwt from "jsonwebtoken";
import { errorMonitor } from "events";
import { match } from "assert";
import { forgotPasswordTemplate } from "../template.js";
import { publishToTopic } from "../producer.js";
import { redisClient } from "../index.js";
import { decode } from "punycode";

export const registerUser = TryCatch(async (req, res, next) => {
  console.log("login called", req.body);
  // console.log("File received:", req.file);

  const { name, email, password, phoneNumber, role, bio } = req.body;

  if (!name || !email || !password || !phoneNumber || !role) {
    throw new ErrorHandler(400, "Please fill all the details");
  }

  const existingUsers =
    await sql`SELECT user_id FROM users WHERE email=${email}`;
  if (existingUsers.length > 0) {
    throw new ErrorHandler(409, "User with this email already exists");
  }

  const hashPassword = await bcrypt.hash(password, 10);
  let registeredUser;

  if (role === "recruiter") {
    const [user] = await sql`
      INSERT INTO users(name, email, password, phone_number, role)  
      VALUES (
        ${name},
        ${email},
        ${hashPassword},
        ${phoneNumber},
        ${role}
      ) 
      RETURNING user_id, name, email, phone_number, role, create_at`;

    registeredUser = user;
  } else if (role === "jobseeker") {
    const file = req.file;
    if (!file) {
      throw new ErrorHandler(400, "Resume file is required");
    }

    const fileBuffer = getBuffer(file);
    if (!fileBuffer || !fileBuffer.content) {
      throw new ErrorHandler(500, "Failed to generate buffer");
    }

    console.log("File buffer:", fileBuffer);
    console.log(
      "Uploading to utils service at:",
      `${process.env.UPLOAD_SERVICE}/api/utils/upload`,
    );
    let data;
    try {
      const response = await axios.post(
        `${process.env.UPLOAD_SERVICE}/api/utils/upload`,
        { buffer: fileBuffer.content },
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
      data = response.data;
      console.log("Upload response:", data);
    } catch (error: any) {
      console.error("FULL UPLOAD ERROR:", error);
      throw new ErrorHandler(
        500,
        error.response?.data?.message || "Failed to upload resume",
      );
    }

    const [user] = await sql`
      INSERT INTO users(name, email, password, phone_number, role, bio, resume, resume_public_id)  
      VALUES (
        ${name},
        ${email},
        ${hashPassword},
        ${phoneNumber},
        ${role},
        ${bio || ""},
        ${data.url},
        ${data.public_id}
      ) 
      RETURNING user_id, name, email, phone_number, role, bio, resume, create_at`;

    registeredUser = user;
  }
  const token = jwt.sign(
    { id: registeredUser?.user_id },
    process.env.SECRET_KEY as string,
    {
      expiresIn: "15d",
    },
  );
  res.status(201).json({
    message: "User registered successfully",
    user: registeredUser,
    token,
  });
});

export const loginUser = TryCatch(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new ErrorHandler(400, " Please fill all details");
  }
  const user = await sql`
  SELECT u.user_id,u.name,u.email,u.password,u.phone_number,u.role,u.bio,u.resume,u.profile_pic,u.subscription,ARRAY_AGG(s.name) FILTER(WHERE s.name IS NOT NULL ) as skills FROM users u LEFT JOIN user_skills us ON u.user_id = us.user_id 
  LEFT JOIN skills s ON us.skill_id =s.skill_id 
  WHERE u.email=${email} GROUP BY u.user_id;

  `;
  if (user.length === 0) {
    throw new ErrorHandler(400, "Invalid credentials");
  }
  // console.log("user:", user);
  const userObject = user[0];
  // console.log("userObject:", userObject);
  const matchPassword = await bcrypt.compare(password, userObject.password);

  if (!matchPassword) {
    throw new ErrorHandler(400, "Invalid Credentials");
  }

  userObject.skills = userObject.skills || [];

  // This where we delete the password from the user object before sending response
  delete userObject.password;

  const token = jwt.sign(
    { id: userObject?.user_id },
    process.env.SECRET_KEY as string,
    {
      expiresIn: "15d",
    },
  );
  res.status(201).json({
    message: "User registered successfully",
    user: userObject,
    token,
  });
});

export const forgetPassword = TryCatch(async (req, res, next) => {
  const { email } = req.body;
  if (!email) {
    throw new ErrorHandler(400, "Email is required");
  }
  const users =
    await sql`SELECT user_id, email FROM users WHERE email =${email}`;

  if (users.length === 0) {
    return res.json({
      message: "If that email exists ,we have sent a reset link ",
    });
  }
  const user = users[0];
  const resetToken = await jwt.sign(
    {
      email: user.email,
      type: "reset",
    },
    process.env.SECRET_KEY as string,
    { expiresIn: "15m" },
  );
  const resetLink = `${process.env.FRONTEND_URL}/reset/${resetToken}`;

  await redisClient.set(`forgot:${email}`,resetToken,{EX:900})

  const message = {
    to: email,
    subject: "RESET Your Password - hireheaven",
    html: forgotPasswordTemplate(resetLink),
  };
  publishToTopic("send-mail", message).catch((error) => {
    console.log("Failed to publish reset password email to kafka ", error);
  });

  res.json({
    message: " If that email ,we have sent a reset link ",
  });
});


export const resetPassword=TryCatch(async(req,res , next)=>{
  const{token}=req.params;
  const{password}=req.body;

  let decoded:any;

  try {
    decoded=jwt.verify(token,process.env.SECRET_KEY as string)
  } catch (error) {
    throw new ErrorHandler(400, "Expired token ")
    
  }
  if (decoded.type!=="reset"){
    throw new ErrorHandler(400,"invalid Token type")
  }

  const email=decoded.email
  const storedToken =await redisClient.get(`forgot:${email}`)
  if (!storedToken || storedToken!==token){
    throw new ErrorHandler(400,"token has been expired")
  }

  const users=await sql`SELECT user_id FROM users WHERE email =${email}`

  if (users.length===0){
    throw new ErrorHandler(404,"User Not Found")
  }
  const user=users[0]

  const hashPassword=await bcrypt.hash(password,10);
  await sql`UPDATE users SET password=${hashPassword} WHERE user_id=${user.user_id}`
  await redisClient.del(`forgot :${email}`)
  res.json({message:"password has changed succefully "})
})