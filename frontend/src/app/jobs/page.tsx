"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAppData } from "@/context/AppContext";
import { Job } from "@/type";
import Loading from "@/components/loading";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  ChevronRight,
  MapPin,
  Search,
  Sparkles,
} from "lucide-react";

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [searchTitle, setSearchTitle] = useState("");
  const [searchLocation, setSearchLocation] = useState("");
  const { loading } = useAppData();

  const fetchJobs = async () => {
    setLoadingJobs(true);
    try {
      const data = await api.jobs.getAll({
        title: searchTitle,
        location: searchLocation,
      });
      setJobs(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingJobs(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchJobs();
  };

  if (loading) return <Loading />;

  return (
    <div className="min-h-screen py-8 sm:py-12">
      <div className="shell space-y-8">
        <div className="glass-card rounded-[2rem] px-6 py-8 sm:px-8 sm:py-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-4 py-2 text-sm font-medium">
            <Sparkles size={16} className="text-primary" />
            Fresh opportunities, cleaner search
          </div>
          <h1 className="mt-5 text-4xl md:text-5xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-teal-600 via-emerald-500 to-amber-500">
            Find Your Dream Job
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-muted-foreground">
            Explore open roles with a sharper browsing experience and faster
            filtering by title and location.
          </p>

          <form
            onSubmit={handleSearch}
            className="mt-8 grid gap-4 rounded-[1.75rem] border border-border/60 bg-background/70 p-4 shadow-sm md:grid-cols-[1fr_1fr_auto]"
          >
            <label className="relative block">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={20}
              />
              <input
                type="text"
                placeholder="Job title, keyword, or company"
                value={searchTitle}
                onChange={(e) => setSearchTitle(e.target.value)}
                className="h-14 w-full rounded-2xl border border-border/70 bg-card/80 pl-12 pr-4 outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <label className="relative block">
              <MapPin
                className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
                size={20}
              />
              <input
                type="text"
                placeholder="Location"
                value={searchLocation}
                onChange={(e) => setSearchLocation(e.target.value)}
                className="h-14 w-full rounded-2xl border border-border/70 bg-card/80 pl-12 pr-4 outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-50"
              />
            </label>
            <Button
              type="submit"
              className="h-14 rounded-2xl px-8 text-base font-semibold shadow-sm"
            >
              Search Jobs
            </Button>
          </form>
        </div>

        {loadingJobs ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : jobs.length === 0 ? (
          <div className="glass-card rounded-[2rem] py-20 text-center">
            <h2 className="text-2xl font-semibold mb-2">No jobs found</h2>
            <p className="text-muted-foreground">Try adjusting your search criteria</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((job) => (
              <Link href={`/jobs/${job.job_id}`} key={job.job_id}>
                <div className="group flex h-full flex-col rounded-[1.75rem] border border-border/60 bg-card/85 p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_24px_60px_-30px_rgba(15,23,42,0.35)]">
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <img 
                      src={job.company_logo || "https://upload.wikimedia.org/wikipedia/commons/a/ac/No_image_available.svg"} 
                      alt={job.company_name} 
                      className="h-14 w-14 rounded-2xl object-cover ring-1 ring-border/60"
                    />
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {job.job_type}
                    </span>
                  </div>
                  
                  <div className="mb-4 flex-grow">
                    <h3 className="text-xl font-semibold mb-1 transition-colors group-hover:text-primary">{job.title}</h3>
                    <p className="text-muted-foreground">{job.company_name}</p>
                  </div>
                  
                  <div className="space-y-3 mt-auto pt-4 border-t border-border/50">
                    <div className="flex items-center text-sm text-muted-foreground">
                      <MapPin size={16} className="mr-2" />
                      {job.location} ({job.work_location})
                    </div>
                    <div className="flex items-center text-sm text-muted-foreground">
                      <Briefcase size={16} className="mr-2" />
                      {job.role}
                    </div>
                    <div className="flex items-center text-sm font-medium pt-2">
                       {job.salary ? `$${job.salary}/year` : "Salary Undisclosed"}
                    </div>
                    <div className="flex items-center gap-2 pt-2 text-sm font-semibold text-primary">
                      View details
                      <ChevronRight
                        size={16}
                        className="transition-transform group-hover:translate-x-1"
                      />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
