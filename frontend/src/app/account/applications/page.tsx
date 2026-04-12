"use client";

import { useAppData, user_service, job_service } from "@/context/AppContext";
import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Briefcase, Calendar, CheckCircle, Clock, XCircle } from "lucide-react";
import Link from "next/link";
import Cookies from "js-cookie";
import Loading from "@/components/loading";

interface Application {
  application_id: number;
  job_id: number;
  status: "pending" | "accepted" | "rejected";
  applied_at: string;
}

const MyApplicationsPage = () => {
  const { user, isAuth, loading } = useAppData();
  const router = useRouter();
  const [applications, setApplications] = useState<Application[]>([]);
  const [pageLoading, setPageLoading] = useState(true);

  useEffect(() => {
    if (!loading && !isAuth) {
      router.push("/auth/login");
    }
    
    if (isAuth && user?.role === "jobseeker") {
      fetchApplications();
    } else if (isAuth && user?.role !== "jobseeker") {
      setPageLoading(false);
    }
  }, [isAuth, loading, user, router]);

  const fetchApplications = async () => {
    const token = Cookies.get("token");
    try {
      const { data } = await axios.get<Application[]>(
        `${user_service}/api/user/application/all`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setApplications(data);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to fetch applications");
    } finally {
      setPageLoading(false);
    }
  };

  if (loading || pageLoading) return <Loading />;

  if (user?.role !== "jobseeker") {
    return <div className="text-center py-20 text-xl">Only job seekers have an applications dashboard.</div>;
  }

  return (
    <div className="min-h-screen p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/account" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={16} className="mr-2" /> Back to Account
        </Link>
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">My Applications</h1>
          <div className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-medium">
            {applications.length} Total
          </div>
        </div>

        {applications.length === 0 ? (
          <div className="bg-card border border-border/50 rounded-2xl p-12 text-center shadow-sm">
            <Briefcase size={48} className="mx-auto text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-xl font-medium mb-2">No Applications Yet</h3>
            <p className="text-muted-foreground mb-6">You haven't applied to any jobs yet. Start exploring!</p>
            <Link href="/jobs">
              <Button>Browse Jobs</Button>
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {applications.map((app) => (
              <Link key={app.application_id} href={`/jobs/${app.job_id}`}>
                <div className="bg-card border border-border/50 hover:border-primary/50 transition-colors rounded-xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer">
                  <div className="space-y-1">
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                       Job ID: #{app.job_id}
                    </h3>
                    <div className="flex items-center text-sm text-muted-foreground gap-4">
                      <span className="flex items-center gap-1">
                        <Calendar size={14} />
                        {new Date(app.applied_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center">
                    {app.status === "pending" && (
                      <span className="flex items-center gap-1.5 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 px-3 py-1.5 rounded-full text-xs font-semibold">
                        <Clock size={14} /> Pending
                      </span>
                    )}
                    {app.status === "accepted" && (
                      <span className="flex items-center gap-1.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-3 py-1.5 rounded-full text-xs font-semibold">
                        <CheckCircle size={14} /> Accepted
                      </span>
                    )}
                    {app.status === "rejected" && (
                      <span className="flex items-center gap-1.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-3 py-1.5 rounded-full text-xs font-semibold">
                        <XCircle size={14} /> Rejected
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default MyApplicationsPage;
