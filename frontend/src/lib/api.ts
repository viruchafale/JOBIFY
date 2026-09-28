import axios from "axios";
import type {
  User,
  Job,
  Application,
  Company,
  ExternalJob,
  ExternalJobSearchParams,
  ExternalJobSearchResponse,
  JobIntelligenceResponse,
} from "@/type";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:5000";

export const apiClient = axios.create({
  baseURL: GATEWAY_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

export const api = {
  auth: {
    login: async (credentials: { email: string; password: string }) => {
      const { data } = await apiClient.post<{ message: string; user: User }>("/api/auth/login", credentials);
      return data;
    },
    register: async (formData: FormData) => {
      const { data } = await apiClient.post<{ message: string; user: User }>("/api/auth/register", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    logout: async () => {
      const { data } = await apiClient.post<{ message: string }>("/api/auth/logout");
      return data;
    },
    forgotPassword: async (email: string) => {
      const { data } = await apiClient.post<{ message: string }>("/api/auth/forgot", { email });
      return data;
    },
    resetPassword: async (token: string, password: string) => {
      const { data } = await apiClient.post<{ message: string }>(`/api/auth/reset/${token}`, { password });
      return data;
    },
  },

  user: {
    getMe: async () => {
      const { data } = await apiClient.get<User>("/api/user/me");
      return data;
    },
    getProfile: async (userId: string | number) => {
      const { data } = await apiClient.get<User>(`/api/user/${userId}`);
      return data;
    },
    updateProfile: async (profileData: Partial<User>) => {
      const { data } = await apiClient.put<{ message: string; updatedUser: User }>("/api/user/update/profile", profileData);
      return data;
    },
    updateProfilePic: async (formData: FormData) => {
      const { data } = await apiClient.put<{ message: string; updatedUser: User }>("/api/user/update/pic", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    updateResume: async (formData: FormData) => {
      const { data } = await apiClient.put<{ message: string; updatedUser: User }>("/api/user/update/resume", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    addSkill: async (skillName: string) => {
      const { data } = await apiClient.post<{ message: string }>("/api/user/skill/add", { skillName });
      return data;
    },
    deleteSkill: async (skillName: string) => {
      const { data } = await apiClient.delete<{ message: string }>("/api/user/skill/delete", {
        data: { skillName },
      } as any);
      return data;
    },
    getMyApplications: async () => {
      const { data } = await apiClient.get<Application[]>("/api/user/application/all");
      return data;
    },
  },

  jobs: {
    getAll: async (params?: { title?: string; location?: string }) => {
      const { data } = await apiClient.get<Job[]>("/api/job/all", { params });
      return data;
    },
    getById: async (jobId: string | number) => {
      const { data } = await apiClient.get<{ job: Job; company: Company }>(`/api/job/${jobId}`);
      return data;
    },
    create: async (jobData: Partial<Job>) => {
      const { data } = await apiClient.post<{ message: string; newJob: Job }>("/api/job/new", jobData);
      return data;
    },
    update: async (jobId: string | number, jobData: Partial<Job>) => {
      const { data } = await apiClient.put<{ message: string; updatedJob: Job }>(`/api/job/update/${jobId}`, jobData);
      return data;
    },
    apply: async (jobId: string | number, formData?: FormData | { resume?: string }) => {
      if (formData instanceof FormData) {
        const { data } = await apiClient.post<{ message: string; application: Application }>(`/api/job/apply/${jobId}`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return data;
      }
      const { data } = await apiClient.post<{ message: string; application: Application }>(`/api/job/apply/${jobId}`, formData || {});
      return data;
    },
    getApplications: async (jobId: string | number) => {
      const { data } = await apiClient.get<Application[]>(`/api/job/application/${jobId}`);
      return data;
    },
    getExternal: async (params?: { title?: string; location?: string; source?: string }) => {
      const { data } = await apiClient.get<ExternalJob[]>("/api/job/external", { params });
      return data;
    },
    searchExternal: async (params?: ExternalJobSearchParams) => {
      const { data } = await apiClient.get<ExternalJobSearchResponse>("/api/job/external/search", { params });
      return data;
    },
    getExternalById: async (id: string | number) => {
      const { data } = await apiClient.get<ExternalJob>(`/api/job/external/${id}`);
      return data;
    },
    getExternalIntelligence: async (id: string | number) => {
      const { data } = await apiClient.get<JobIntelligenceResponse>(`/api/job/external/${id}/intelligence`);
      return data;
    },
    updateApplicationStatus: async (applicationId: string | number, status: "Submitted" | "Rejected" | "Hired") => {
      const { data } = await apiClient.put<{ message: string; updatedApplication: Application }>(`/api/job/application/update/${applicationId}`, { status });
      return data;
    },
  },

  companies: {
    getAll: async () => {
      const { data } = await apiClient.get<Company[]>("/api/job/company/all");
      return data;
    },
    getDetails: async (companyId: string | number) => {
      const { data } = await apiClient.get<Company & { jobs: Job[] }>(`/api/job/company/${companyId}`);
      return data;
    },
    create: async (formData: FormData) => {
      const { data } = await apiClient.post<{ message: string; newCompany: Company }>("/api/job/company/new", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data;
    },
    delete: async (companyId: string | number) => {
      const { data } = await apiClient.delete<{ message: string }>(`/api/job/company/${companyId}`);
      return data;
    },
  },

  utils: {
    careerGuide: async (skills: string[]) => {
      const { data } = await apiClient.post<{
        summary: string;
        jobOptions: { title: string; description: string; matchReason: string }[];
        skillsToLearn: { skill: string; reason: string; resources: string[] }[];
        learningApproach: { title: string; points: string[] };
      }>("/api/utils/career", { skills });
      return data;
    },
    resumeAnalyzer: async (base64Pdf: string) => {
      const { data } = await apiClient.post<{
        atsScore: number;
        summary: string;
        strengths: string[];
        weaknesses: string[];
        improvements: string[];
        keywordMatches: string[];
      }>("/api/utils/resume-analyzer", { pdfBase64: base64Pdf });
      return data;
    },
  },
};
