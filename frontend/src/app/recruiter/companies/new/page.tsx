"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { job_service, useAppData } from "@/context/AppContext";
import Loading from "@/components/loading";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import toast from "react-hot-toast";
import Cookies from "js-cookie";
import { Upload } from "lucide-react";

export default function CreateCompanyPage() {
  const { isAuth, user, loading } = useAppData();
  const router = useRouter();
  const [submitLoading, setSubmitLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    website: "",
  });
  const [logo, setLogo] = useState<File | null>(null);

  useEffect(() => {
    if (!loading && (!isAuth || user?.role !== "recruiter")) {
      toast.error("Unauthorized access");
      router.push("/");
    }
  }, [isAuth, user, loading, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logo) {
      toast.error("Please upload a company logo");
      return;
    }

    setSubmitLoading(true);
    const data = new FormData();
    data.append("name", formData.name);
    data.append("description", formData.description);
    data.append("website", formData.website);
    data.append("file", logo); // backend expects 'file' for logo

    try {
      const token = Cookies.get("token");
      await axios.post(
        `${job_service}/api/job/company/new`,
        data,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data",
          },
        }
      );
      toast.success("Company created successfully!");
      // Send them back to post job page or company listing
      router.push("/recruiter/jobs/new");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to create company");
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) return <Loading />;

  return (
    <div className="min-h-screen bg-background p-6 md:p-12">
      <div className="max-w-2xl mx-auto">
        <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-sm">
          <h1 className="text-3xl font-bold mb-2">Create Company Profile</h1>
          <p className="text-muted-foreground mb-8">Establish your brand presence before posting jobs.</p>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium">Company Name</label>
              <input
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g. Acme Corp"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Website URL</label>
              <input
                name="website"
                type="url"
                required
                value={formData.website}
                onChange={handleChange}
                className="w-full h-11 px-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="https://example.com"
              />
            </div>

            <div className="space-y-4 pt-2">
              <label className="text-sm font-medium">Company Logo</label>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-xl border border-dashed border-border/60 flex items-center justify-center bg-accent/50 overflow-hidden shrink-0">
                  {logo ? (
                    <img src={URL.createObjectURL(logo)} alt="Logo Preview" className="h-full w-full object-cover" />
                  ) : (
                    <Upload size={24} className="text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    required
                    onChange={(e) => {
                      if (e.target.files?.[0]) setLogo(e.target.files[0]);
                    }}
                    className="w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 cursor-pointer"
                  />
                  <p className="text-xs text-muted-foreground mt-2">Recommended: Square image, max 2MB (JPEG, PNG).</p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Company Description</label>
              <textarea
                name="description"
                required
                rows={4}
                value={formData.description}
                onChange={handleChange}
                className="w-full p-3 border border-border/50 rounded-md bg-transparent focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                placeholder="What does your company do? What is your mission?"
              />
            </div>

            <div className="pt-4">
              <Button type="submit" size="lg" className="w-full h-12" disabled={submitLoading}>
                {submitLoading ? "Creating Profile..." : "Create Company Profile"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
