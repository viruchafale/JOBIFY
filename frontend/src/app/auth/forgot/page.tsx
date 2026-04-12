"use client";

import { auth_service } from "@/context/AppContext";
import React, { FormEvent, useState } from "react";
import toast from "react-hot-toast";
import { Label } from "@/components/ui/label";
import { ArrowRight, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import axios from "axios";
import Link from "next/link";

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState("");
  const [btnLoading, setBtnLoading] = useState(false);

  const submitHandler = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBtnLoading(true);
    try {
      const { data } = await axios.post<{message: string}>(
        `${auth_service}/api/auth/forgot`,
        { email }
      );
      toast.success(data.message);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to send reset link");
    } finally {
      setBtnLoading(false);
      setEmail("");
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">
            Forgot Password
          </h1>
          <p className="text-sm opacity-70">Enter your email to receive a reset link</p>
        </div>
        <div className="border border-gray-400/50 rounded-2xl p-8 shadow-2xl backdrop-blur-md bg-card/60">
          <form onSubmit={submitHandler} className="space-y-6">
            <div className="space-y-3">
              <Label htmlFor="email" className="text-sm font-medium">
                Email Address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 opacity-50" />
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full pl-10 h-11 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
            </div>

            <Button disabled={btnLoading} className="w-full h-11 text-base">
              {btnLoading ? "Sending Link..." : "Send Reset Link"}
              <ArrowRight size={18} className="ml-2" />
            </Button>
          </form>
          <div className="mt-6 pt-6 border-t border-gray-400/50">
            <p className="text-center text-sm">
              Remembered your password?{" "}
              <Link
                href={"/auth/login"}
                className="text-blue-500 font-medium hover:underline transition-all"
              >
                Sign In Instead
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
