import { AuthenticatedRequest } from "../middleware/auth.js";
import getBuffer from "../utils/buffer.js";
import { sql } from "../utils/db.js";
import ErrorHandler from "../utils/errorHandler.js";
import { TryCatch } from "../utils/TryCatch.js";

export const createCompany = TryCatch(
  async (req: AuthenticatedRequest, res) => {
    const user = req.user;

    if (!user) {
      throw new ErrorHandler(401, "Authentication required");
    }

    if (user.role !== "recruiter") {
      throw new ErrorHandler(
        403,
        "Forbidden:Only recruiter can create a company ",
      );
    }

    const { name, description, website } = req.body;

    if (!name || !description || !website) {
      throw new ErrorHandler(409, "All the fields required");
    }

    const existingCompanies =
      await sql`SELECT company_id FROM companies WHERE name =${name}`;
      if (existingCompanies.length>0){
        throw new ErrorHandler(409,`A company with the name ${name} already exists`)
      }

      const file =req.file

      if(!file){
        throw new ErrorHandler(400,"Company Logo file is required");
      }

      const fileBUffer=getBuffer(file)

      if(!fileBUffer || !fileBUffer.content){
        throw new ErrorHandler(500,"Failed to create file buffer")
      }

      interface UploadResponse {
        url: string;
        public_id: string;
      }

      const { data }: { data: UploadResponse } = await axios.post(`${process.env.UPLOAD_SERVICE}/api/utils/upload`,
        { buffer: fileBUffer.content }
      )
      const [newCompany]=await sql `
        INSERT INTO companies (name,description ,website ,logo,logo_public_id,recruiter_id) VALUES (${name}, ${description},${data.url},${data.public_id},${req.user?.user_id}) RETURNING *
      `
      res.json({
        message:"Company Added Succesfully  ",
        company:newCompany
      })
  },
);
