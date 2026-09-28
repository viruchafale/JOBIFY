"use client";

import { useAppData } from "@/context/AppContext";
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Briefcase, Building, ChevronDown, ChevronUp, User, Trash2, Edit } from "lucide-react";
import Link from "next/link";
import Loading from "@/components/loading";

interface Application {
  application_id: number;
  job_id: number;
  applicant_email: string;
  resume: string;
  status: "Submitted" | "Rejected" | "Hired";
  applied_at: string;
}

interface JobWithApps {
  job_id: number;
  title: string;
  applications: Application[];
  loadingApps: boolean;
  expanded: boolean;
}

interface Company {
  company_id: number;
  name: string;
}

const RecruiterDashboardPage = () => {
  const { user, isAuth, loading } = useAppData();
  const router = useRouter();
  
  const [companies, setCompanies] = useState<Company[]>([]);
  const [jobs, setJobs] = useState<JobWithApps[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    if (!loading && !isAuth) {
      router.push("/auth/login");
    }
    
    if (isAuth && user?.role === "recruiter") {
      fetchCompanies();
    } else if (isAuth && user?.role !== "recruiter") {
      setPageLoading(false);
    }
  }, [isAuth, loading, user, router]);

  const fetchCompanies = async () => {
    try {
      const data = await api.companies.getAll();
      setCompanies(data);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to fetch companies");
    } finally {
      setPageLoading(false);
    }
  };

  const fetchJobsForCompany = async (companyId: number) => {
    try {
      setJobs([]);
      const data = await api.companies.getDetails(companyId);
      const jobsList = data.jobs || [];
      const initialized = jobsList.map((j: any) => ({
        ...j,
        applications: [],
        loadingApps: false,
        expanded: false
      }));
      setJobs(initialized);
      setSelectedCompanyId(companyId);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to fetch jobs");
    }
  };

  const toggleJobExpanded = async (jobId: number, idx: number) => {
    const newJobs = [...jobs];
    const job = newJobs[idx];

    if (!job.expanded && job.applications.length === 0) {
      job.loadingApps = true;
      setJobs([...newJobs]);
      try {
        const data = await api.jobs.getApplications(jobId);
        job.applications = data as any;
      } catch (error) {
        toast.error("Failed to load applications");
      }
      job.loadingApps = false;
    }

    job.expanded = !job.expanded;
    setJobs([...newJobs]);
  };

  const deleteCompany = async (companyId: number) => {
    if (!confirm("Are you sure you want to delete this company and all its jobs?")) return;
    try {
      await api.companies.delete(companyId);
      toast.success("Company deleted");
      setCompanies(companies.filter(c => c.company_id !== companyId));
      if (selectedCompanyId === companyId) {
        setSelectedCompanyId(null);
        setJobs([]);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to delete company");
    }
  };

  const updateAppStatus = async (appId: number, status: "Submitted" | "Rejected" | "Hired", jobIdx: number, appIdx: number) => {
    try {
      await api.jobs.updateApplicationStatus(appId, status);
      toast.success(`Application marked as ${status}`);
      
      const newJobs = [...jobs];
      newJobs[jobIdx].applications[appIdx].status = status;
      setJobs(newJobs);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to update status");
    }
  };

  if (loading || pageLoading) return <Loading />;

  if (user?.role !== "recruiter") {
    return <div className="text-center py-20 text-xl">Only recruiters can view this dashboard.</div>;
  }

  return (
    <div className="min-h-screen p-6 md:p-12">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Recruiter Dashboard</h1>
        </div>

        <div className="grid md:grid-cols-4 gap-8">
          <div className="bg-card border border-border/50 rounded-xl p-6 shadow-sm space-y-4 h-fit">
            <h2 className="font-semibold text-lg flex items-center gap-2 border-b border-border/50 pb-2">
              <Building size={18} /> My Companies
            </h2>
            {companies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No companies found.</p>
            ) : (
              <ul className="space-y-2">
                {companies.map(c => (
                  <li key={c.company_id} className="flex items-center gap-2">
                    <button 
                      onClick={() => fetchJobsForCompany(c.company_id)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium transition-colors ${selectedCompanyId === c.company_id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                    >
                      {c.name}
                    </button>
                    <button 
                      onClick={() => deleteCompany(c.company_id)}
                      className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-md transition-colors"
                      title="Delete Company"
                    >
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="md:col-span-3 space-y-4">
            {!selectedCompanyId ? (
              <div className="bg-card border border-border/50 rounded-xl p-12 text-center shadow-sm">
                <Briefcase size={48} className="mx-auto text-muted-foreground mb-4 opacity-50" />
                <h3 className="text-xl font-medium mb-2">Select a Company</h3>
                <p className="text-muted-foreground">Click on a company to view jobs and manage applicants.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <h2 className="text-2xl font-semibold mb-6">Jobs & Applications</h2>
                {jobs.length === 0 ? (
                  <div className="text-center py-12 bg-card rounded-xl border border-border/50">
                    <p className="text-muted-foreground mb-4">No jobs posted for this company yet.</p>
                  </div>
                ) : (
                  jobs.map((job, jIdx) => (
                    <div key={job.job_id} className="bg-card border border-border/50 rounded-xl shadow-sm overflow-hidden">
                      <div 
                        className="p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
                      >
                        <div 
                          className="font-semibold cursor-pointer flex-grow"
                          onClick={() => toggleJobExpanded(job.job_id, jIdx)}
                        >
                          {job.title}
                        </div>
                        <div className="flex items-center gap-4">
                          <Link href={`/recruiter/jobs/${job.job_id}/edit`}>
                            <button className="text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 text-sm bg-transparent border-none cursor-pointer">
                              <Edit size={16} /> Edit
                            </button>
                          </Link>
                          <div className="cursor-pointer" onClick={() => toggleJobExpanded(job.job_id, jIdx)}>
                            {job.expanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                          </div>
                        </div>
                      </div>
                      
                      {job.expanded && (
                        <div className="p-4 border-t border-border/50 bg-muted/10">
                          {job.loadingApps ? (
                            <p className="text-sm text-muted-foreground py-2 text-center">Loading applications...</p>
                          ) : job.applications.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-2 text-center">No applications for this job.</p>
                          ) : (
                            <div className="space-y-3">
                              {job.applications.map((app, aIdx) => (
                                <div key={app.application_id} className="bg-background border border-border/50 p-4 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                  <div>
                                    <div className="font-medium flex items-center gap-2">
                                      <User size={16} /> {app.applicant_email}
                                    </div>
                                    <div className="text-sm text-muted-foreground mt-1">
                                      Applied: {new Date(app.applied_at).toLocaleDateString()}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <a href={app.resume} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline text-sm font-medium mr-2">
                                      View Resume
                                    </a>
                                    <select 
                                      className="h-9 px-3 border border-border rounded-md text-sm bg-background"
                                      value={app.status}
                                      onChange={(e) => updateAppStatus(app.application_id, e.target.value as "Submitted" | "Rejected" | "Hired", jIdx, aIdx)}
                                    >
                                      <option value="Submitted">Submitted</option>
                                      <option value="Hired">Hire</option>
                                      <option value="Rejected">Reject</option>
                                    </select>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecruiterDashboardPage;
