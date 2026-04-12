"use client";

import { auth_service } from "@/context/AppContext";
import React, { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import { Label } from "@/components/ui/label";
import { ArrowRight, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import axios from "axios";
import { useRouter, useParams } from "next/navigation";

const ResetPasswordPage = () => {
  const params = useParams();
  const token = params.token as string;
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [btnLoading, setBtnLoading] = useState(false);

  const submitHandler = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBtnLoading(true);
    try {
      const { data } = await axios.post<{message: string}>(
        `${auth_service}/api/auth/reset/${token}`,
        { password }
      );
      toast.success(data.message);
      router.push("/auth/login");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to reset password");
    } finally {
      setBtnLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Reset Password
          </h1>
          <p className="text-sm opacity-70">Enter your new password below</p>
        </div>
        <div className="border border-gray-400/50 rounded-2xl p-8 shadow-2xl backdrop-blur-md bg-card/60">
          <form onSubmit={submitHandler} className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="password" className="text-sm font-medium">
                New Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 opacity-50" />
                <input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full pl-10 h-11 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>

            <Button disabled={btnLoading} className="w-full h-11 text-base">
              {btnLoading ? "Resetting..." : "Reset Password"}
              <ArrowRight size={18} className="ml-2" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
