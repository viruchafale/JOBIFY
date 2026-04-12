"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { job_service, useAppData } from "@/context/AppContext";
import { Company, Job } from "@/type";
import Loading from "@/components/loading";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import Cookies from "js-cookie";

export default function EditJobPage() {
  const { isAuth, user, loading } = useAppData();
  const router = useRouter();
  const { jobId } = useParams();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    salary: "",
    location: "",
    role: "",
    job_type: "Full-time",
    work_location: "On-site",
    company_id: "",
    openings: "1",
  });

  useEffect(() => {
    if (!loading && (!isAuth || user?.role !== "recruiter")) {
      toast.error("Unauthorized access");
      router.push("/");
    }
  }, [isAuth, user, loading, router]);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const token = Cookies.get("token");
        // Fetch companies
        const compRes = await axios.get<Company[]>(`${job_service}/api/job/company/all`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setCompanies(compRes.data);

        // Fetch job
        const jobRes = await axios.get<Job>(`${job_service}/api/job/${jobId}`);
        const job = jobRes.data;
        
        setFormData({
          title: job.title,
          description: job.description,
          salary: job.salary ? job.salary.toString() : "",
          location: job.location,
          role: job.role,
          job_type: job.job_type,
          work_location: job.work_location,
          company_id: job.company_id.toString(),
          openings: job.openings ? job.openings.toString() : "1",
        });
      } catch (error: any) {
        toast.error("Failed to load data");
      } finally {
        setLoadingInitial(false);
      }
    };
    
    if (isAuth && user?.role === "recruiter") {
      fetchInitialData();
    }
  }, [isAuth, user, jobId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_id) {
      toast.error("Please select a company");
      return;
    }

    setSubmitLoading(true);
    try {
      const token = Cookies.get("token");
      await axios.put(
        `${job_service}/api/job/update/${jobId}`,
        {
          ...formData,
          salary: Number(formData.salary),
          openings: Number(formData.openings),
          company_id: Number(formData.company_id)
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      toast.success("Job updated successfully!");
      router.push("/recruiter/applications");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to update job");
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading || loadingInitial) return <Loading />;

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-3xl mx-auto">
        <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-sm">
          <h1 className="text-3xl font-bold mb-8">Edit Job</h1>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Job Title</label>
                <input
                  name="title"
                  required
                  value={formData.title}
                  onChange={handleChange}
                  className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              
              <div className="space-y-2">
                <label className="text-sm font-medium">Role</label>
                <input
                  name="role"
                  required
                  value={formData.role}
                  onChange={handleChange}
                  className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Company</label>
                <select
                  name="company_id"
                  required
                  value={formData.company_id}
                  onChange={handleChange}
                  className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {companies.map(company => (
                    <option key={company.company_id} value={company.company_id}>{company.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Job Type</label>
                <select
                  name="job_type"
                  required
                  value={formData.job_type}
                  onChange={handleChange}
                  className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="Full-time">Full-time</option>
                  <option value="Part-time">Part-time</option>
                  <option value="Contract">Contract</option>
                  <option value="Internship">Internship</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Work Location</label>
                <select
                  name="work_location"
                  required
                  value={formData.work_location}
                  onChange={handleChange}
                  className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="On-site">On-site</option>
                  <option value="Remote">Remote</option>
                  <option value="Hybrid">Hybrid</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Location</label>
                <input
                  name="location"
                  required
                  value={formData.location}
                  onChange={handleChange}
                  className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Salary</label>
                <input
                  type="number"
                  name="salary"
                  required
                  value={formData.salary}
                  onChange={handleChange}
                  className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Openings</label>
                <input
                  type="number"
                  name="openings"
                  min="1"
                  required
                  value={formData.openings}
                  onChange={handleChange}
                  className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Detailed Description</label>
              <textarea
                name="description"
                required
                rows={6}
                value={formData.description}
                onChange={handleChange}
                className="w-full p-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />
            </div>

            <div className="pt-4 flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => router.push("/recruiter/applications")}>
                Cancel
              </Button>
              <Button type="submit" size="lg" className="w-full md:w-auto px-10 h-12" disabled={submitLoading}>
                {submitLoading ? "Updating..." : "Update Job"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
