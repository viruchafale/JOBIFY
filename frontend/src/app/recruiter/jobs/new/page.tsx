"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppData } from "@/context/AppContext";
import { Company } from "@/type";
import Loading from "@/components/loading";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";

export default function PostJobPage() {
  const { isAuth, user, loading } = useAppData();
  const router = useRouter();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
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
    const fetchCompanies = async () => {
      try {
        const data = await api.companies.getAll();
        setCompanies(data);
        if (data.length > 0) {
          setFormData(prev => ({ ...prev, company_id: data[0].company_id.toString() }));
        }
      } catch (error) {
        console.error(error);
        toast.error("Failed to load companies");
      } finally {
        setLoadingCompanies(false);
      }
    };
    if (isAuth && user?.role === "recruiter") {
      fetchCompanies();
    }
  }, [isAuth, user]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.company_id) {
      toast.error("Please select a company or create one first");
      return;
    }

    setSubmitLoading(true);
    try {
      await api.jobs.create({
        ...formData,
        salary: Number(formData.salary) as any,
        openings: Number(formData.openings) as any,
        company_id: Number(formData.company_id),
        job_type: formData.job_type as any,
        work_location: formData.work_location as any,
      });
      toast.success("Job posted successfully!");
      router.push("/jobs");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to post job");
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading || loadingCompanies) return <Loading />;

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-3xl mx-auto">
        <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-sm">
          <h1 className="text-3xl font-bold mb-8">Post a New Job</h1>
          
          {companies.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground mb-4">You need to create a company profile first before posting a job.</p>
              <Button onClick={() => router.push("/recruiter/companies/new")}>Create Company</Button>
            </div>
          ) : (
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
                    placeholder="e.g. Senior Frontend Developer"
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
                    placeholder="e.g. Developer, Designer"
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
                  <label className="text-sm font-medium">Location (City, Country)</label>
                  <input
                    name="location"
                    required
                    value={formData.location}
                    onChange={handleChange}
                    className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g. San Francisco, US"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Salary (Yearly in USD)</label>
                  <input
                    type="number"
                    name="salary"
                    required
                    value={formData.salary}
                    onChange={handleChange}
                    className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                    placeholder="e.g. 120000"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Number of Openings</label>
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
                  placeholder="Describe the job responsibilities, requirements, and benefits..."
                />
              </div>

              <div className="pt-4 flex justify-end">
                <Button type="submit" size="lg" className="w-full md:w-auto px-10 h-12" disabled={submitLoading}>
                  {submitLoading ? "Posting..." : "Post Job"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
