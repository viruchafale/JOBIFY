import { ReactNode } from "react";

export interface JobOptions {
  title: string;
  responsibilities: string;
  why: string;
}

export interface SkillsToLearn {
  title: string;
  why: string;
  how: string;
}

export interface SkillCategory {
  category: string;
  skills: SkillsToLearn[];
}

export interface LearningApproach {
  title: string;
  points: string[];
}

export interface CareerGuideResponse {
  summary: string;
  jobOptions: JobOptions[];
  skillsToLearn: SkillCategory[];
  learningApproach: LearningApproach;
}

export interface scoreBreakdown{
  formatting:{score:number;feedback:string};
  keywords:{score:number;feedback:string};
  structure:{score:number;feedback:string};
  readability:{score:number;feedback:string};

}

export interface Suggestion{
  category:string;
  issue:string;
  recommendation:string;
  priority:"high" | "medium" | "low";
}

export interface ResumeAnalysisResponse{
  atsScore:number;
  scoreBreakdown:scoreBreakdown;
  suggestions:Suggestion[];
  strengths:string[];
  summary:string;
}


export interface User{
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

export interface AppContextType{
  user:User | null;
  loading:boolean;
  btnLoading:boolean;
  isAuth:boolean
  setUser:React.Dispatch<React.SetStateAction<User|null>>
  setLoading:React.Dispatch<React.SetStateAction<boolean>>
  setIsAuth:React.Dispatch<React.SetStateAction<boolean>>
  logoutUser:()=>Promise<void>
}



export interface AppProviderProps{
  children :ReactNode
}

export interface ApiResponse<T>{
  message:string;
  user:T,
}

export interface AccountProps{
  user:User;
  isYourAccount:boolean
}

export interface Company {
  company_id: number;
  name: string;
  description: string;
  website: string;
  logo: string;
  logo_public_id: string;
  recruiter_id: number;
  created_at: string;
}

export interface Job {
  job_id: number;
  title: string;
  description: string;
  salary: number;
  location: string;
  job_type: "Full-time" | "Part-time" | "Contract" | "Internship";
  role: string;
  work_location: "On-site" | "Remote" | "Hybrid";
  created_at: string;
  company_name: string;
  company_logo: string;
  company_id: number;
  openings: number;
}

export interface ExternalJob {
  id: number;
  source: string;
  source_job_id: string;
  canonical_url: string;
  apply_url: string | null;
  company_name: string;
  title: string;
  description: string;
  location: string | null;
  job_type: string | null;
  work_location: string | null;
  role: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  posted_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
  content_fingerprint: string;
}

// Phase 7 — advanced search over external jobs. Deliberately narrower than
// ExternalJob (omits source_job_id/first_seen_at/content_fingerprint — see
// services/job/src/ingestion/search.ts's SEARCH_RESULT_COLUMNS).
export interface ExternalJobSearchResult {
  id: number;
  source: string;
  canonical_url: string;
  apply_url: string | null;
  company_name: string;
  title: string;
  description: string;
  location: string | null;
  job_type: string | null;
  work_location: string | null;
  role: string | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  posted_at: string | null;
  last_seen_at: string;
  is_active: boolean;
}

export type ExternalJobSort = "relevance" | "newest" | "oldest" | "salary_high" | "salary_low";

export interface ExternalJobSearchParams {
  q?: string;
  location?: string;
  company?: string;
  source?: string;
  jobType?: string;
  workLocation?: string;
  role?: string;
  minSalary?: number;
  maxSalary?: number;
  postedAfter?: string;
  postedBefore?: string;
  active?: boolean;
  page?: number;
  limit?: number;
  sort?: ExternalJobSort;
}

export interface ExternalJobSearchPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ExternalJobSearchResponse {
  data: {
    items: ExternalJobSearchResult[];
    pagination: ExternalJobSearchPagination;
  };
}

// Phase 8 — derived job intelligence. All of this is JobiFy-computed
// analysis, not employer-supplied data — see docs/intelligence.md.
export interface JobIntelligenceSkill {
  name: string;
  category: string;
  skillType: string;
  requirementLevel: "required" | "preferred" | "mentioned";
  source: "deterministic" | "ai";
}

export interface JobIntelligenceData {
  status: "completed" | "failed" | "retryable_failed";
  extractorVersion: string;
  processedAt: string | null;
  seniority: { value: string; evidence: string | null };
  experience: { minYears: number | null; maxYears: number | null; evidence: string | null };
  education: { level: string; evidence: string | null };
  employmentType: string | null;
  workArrangement: string | null;
  compensation: { min: number | null; max: number | null; currency: string | null };
  summary: string | null;
  summarySource: "ai" | null;
  skills: JobIntelligenceSkill[];
  responsibilities: { text: string; source: "deterministic" | "ai" }[];
  requirements: { text: string; level: "required" | "preferred"; source: "deterministic" | "ai" }[];
}

export interface JobIntelligenceResponse {
  data: JobIntelligenceData;
}

export interface Application {
  application_id: number;
  job_id: number;
  applicant_id?: number;
  applicant_name?: string;
  applicant_email?: string;
  applicant_phone?: string;
  status: "Submitted" | "Rejected" | "Hired";
  applied_at?: string;
  created_at?: string;
  resume?: string;
  title?: string;
  company_name?: string;
  company_logo?: string;
  location?: string;
  job_type?: string;
  work_location?: string;
  salary?: number;
  job?: Job;
  user?: User;
}

