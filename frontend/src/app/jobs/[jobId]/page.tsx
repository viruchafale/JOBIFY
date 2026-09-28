"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppData } from "@/context/AppContext";
import { Job } from "@/type";
import Loading from "@/components/loading";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MapPin, Briefcase, DollarSign, Calendar, Users, Building, ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";
import Link from "next/link";

export default function JobDetailsPage() {
  const { jobId } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [loadingJob, setLoadingJob] = useState(true);
  const [applyLoading, setApplyLoading] = useState(false);
  const { isAuth, user } = useAppData();
  const router = useRouter();

  useEffect(() => {
    const fetchJobDetails = async () => {
      try {
        const data = await api.jobs.getById(jobId as string);
        setJob(data as any);
      } catch (error) {
        toast.error("Failed to fetch job details");
        console.error(error);
      } finally {
        setLoadingJob(false);
      }
    };
    if (jobId) {
      fetchJobDetails();
    }
  }, [jobId]);

  const handleApply = async () => {
    if (!isAuth || !user) {
      toast.error("Please login to apply for this job");
      router.push("/auth/login");
      return;
    }

    if (user.role !== "jobseeker") {
      toast.error("Only jobseekers can apply for jobs");
      return;
    }

    setApplyLoading(true);
    try {
      const data = await api.jobs.apply(jobId as string);
      toast.success(data.message || "Applied successfully!");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to apply");
    } finally {
      setApplyLoading(false);
    }
  };

  if (loadingJob) return <Loading />;
  if (!job) return <div className="text-center py-20">Job not found</div>;

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/jobs" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={16} className="mr-2" /> Back to Jobs
        </Link>
        
        <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div className="flex gap-6">
              <div className="w-20 h-20 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
                 {/*  We might not have company_logo from getSingleJob (if no join in getSingleJob), 
                      let's show a building icon fallback */}
                 <Building size={32} className="text-primary" />
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-bold">{job.title}</h1>
                <p className="text-xl text-muted-foreground">Company Details in Progress</p>
                <div className="flex flex-wrap gap-3 mt-4">
                  <span className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-3 py-1 rounded-full text-xs font-medium">
                    {job.job_type}
                  </span>
                  <span className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-3 py-1 rounded-full text-xs font-medium">
                    {job.work_location}
                  </span>
                </div>
              </div>
            </div>
            <div className="shrink-0 w-full md:w-auto">
              {isAuth && user?.role === "jobseeker" ? (
                <Button 
                  size="lg" 
                  className="w-full md:w-auto font-semibold px-8 h-12"
                  onClick={handleApply}
                  disabled={applyLoading}
                >
                  {applyLoading ? "Applying..." : "Apply Now"}
                </Button>
              ) : isAuth && user?.role === "recruiter" ? (
                 <Button disabled variant="outline" className="w-full">Recruiters Cannot Apply</Button>
              ) : (
                <Button 
                  size="lg" 
                  className="w-full md:w-auto font-semibold px-8 h-12"
                  onClick={() => router.push("/auth/login")}
                >
                  Sign in to Apply
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 bg-card border border-border/50 rounded-2xl p-8 shadow-sm space-y-6">
            <div>
              <h2 className="text-2xl font-semibold mb-4">Job Description</h2>
              <div className="text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {job.description}
              </div>
            </div>
            
            <div className="pt-6 border-t border-border/50 hidden">
              {/* Optional: we can add requirements if they exist in schema later */}
            </div>
          </div>
          
          <div className="space-y-6">
            <div className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm space-y-6">
              <h3 className="font-semibold text-lg border-b border-border/50 pb-4">Job Overview</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <MapPin className="text-primary mt-1" size={20} />
                  <div>
                    <p className="font-medium">Location</p>
                    <p className="text-sm text-muted-foreground">{job.location}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <DollarSign className="text-primary mt-1" size={20} />
                  <div>
                    <p className="font-medium">Salary</p>
                    <p className="text-sm text-muted-foreground">{job.salary ? `$${job.salary}/year` : "Undisclosed"}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Briefcase className="text-primary mt-1" size={20} />
                  <div>
                    <p className="font-medium">Role</p>
                    <p className="text-sm text-muted-foreground">{job.role}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Users className="text-primary mt-1" size={20} />
                  <div>
                    <p className="font-medium">Openings</p>
                    <p className="text-sm text-muted-foreground">{job.openings}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="text-primary mt-1" size={20} />
                  <div>
                    <p className="font-medium">Posted Date</p>
                    <p className="text-sm text-muted-foreground">{new Date(job.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
