import getBuffer from "../utils/buffer.js";
import { sql } from "../utils/db.js";
import ErrorHandler from "../utils/errorHandler.js";
import { TryCatch } from "../utils/TryCatch.js";
import axios from "axios";
export const createCompany = TryCatch(async (req, res) => {
    const user = req.user;
    if (!user) {
        throw new ErrorHandler(401, "Authentication required");
    }
    if (user.role !== "recruiter") {
        throw new ErrorHandler(403, "Forbidden:Only recruiter can create a company ");
    }
    const { name, description, website } = req.body;
    if (!name || !description || !website) {
        throw new ErrorHandler(409, "All the fields required");
    }
    const existingCompanies = await sql `SELECT company_id FROM companies WHERE name =${name}`;
    if (existingCompanies.length > 0) {
        throw new ErrorHandler(409, `A company with the name ${name} already exists`);
    }
    const file = req.file;
    if (!file) {
        throw new ErrorHandler(400, "Company Logo file is required");
    }
    const fileBuffer = getBuffer(file);
    if (!fileBuffer || !fileBuffer.content) {
        throw new ErrorHandler(500, "Failed to create file buffer");
    }
    let data;
    try {
        const response = await axios.post(`${process.env.UPLOAD_SERVICE}/api/utils/upload`, { buffer: fileBuffer.content });
        data = response.data;
    }
    catch (error) {
        throw new ErrorHandler(500, error.response?.data?.message || "Upload failed");
    }
    const [newCompany] = await sql `
          INSERT INTO companies (name, description, website, logo, logo_public_id, recruiter_id) 
          VALUES (${name}, ${description}, ${website}, ${data.url}, ${data.public_id}, ${user.user_id}) 
          RETURNING *
        `;
    res.json({
        message: "Company Added Succesfully  ",
        company: newCompany
    });
});
