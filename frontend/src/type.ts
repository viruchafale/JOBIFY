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
  token:string
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