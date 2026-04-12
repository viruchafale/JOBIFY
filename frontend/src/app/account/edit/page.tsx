"use client";

import { useAppData, user_service } from "@/context/AppContext";
import React, { FormEvent, useEffect, useState } from "react";
import toast from "react-hot-toast";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ArrowLeft, User, Phone, FileText, Upload, Plus, X } from "lucide-react";
import Link from "next/link";
import Cookies from "js-cookie";

const EditProfilePage = () => {
  const { user, isAuth, loading, setUser } = useAppData();
  const router = useRouter();

  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [bio, setBio] = useState("");
  
  const [picFile, setPicFile] = useState<File | null>(null);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  
  const [skillName, setSkillName] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  
  const [btnLoading, setBtnLoading] = useState(false);
  const [picLoading, setPicLoading] = useState(false);
  const [resumeLoading, setResumeLoading] = useState(false);

  useEffect(() => {
    if (!loading && !isAuth) {
      router.push("/auth/login");
    }
    if (user) {
      setName(user.name || "");
      setPhoneNumber(user.phone_number || "");
      setBio(user.bio || "");
      setSkills(user.skills || []);
    }
  }, [user, isAuth, loading, router]);

  const submitHandler = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBtnLoading(true);
    const token = Cookies.get("token");
    try {
      const { data } = await axios.put<{ message: string; updatedUser: any }>(
        `${user_service}/api/user/update/profile`,
        { name, phone_number: phoneNumber, bio },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(data.message || "Profile updated successfully!");
      if (data.updatedUser) {
        setUser({ ...user, ...data.updatedUser } as any);
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to update profile");
    } finally {
      setBtnLoading(false);
    }
  };

  const uploadPic = async () => {
    if (!picFile) return toast.error("Please select an image");
    setPicLoading(true);
    const token = Cookies.get("token");
    const formData = new FormData();
    formData.append("file", picFile);
    try {
      const { data } = await axios.put<{ message: string; updatedUser: any }>(
        `${user_service}/api/user/update/pic`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" } }
      );
      toast.success("Profile picture updated!");
      if (data.updatedUser) setUser({ ...user, ...data.updatedUser } as any);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to upload picture");
    } finally {
      setPicLoading(false);
      setPicFile(null);
    }
  };

  const uploadResume = async () => {
    if (!resumeFile) return toast.error("Please select a file");
    setResumeLoading(true);
    const token = Cookies.get("token");
    const formData = new FormData();
    formData.append("file", resumeFile);
    try {
      const { data } = await axios.put<{ message: string; updatedUser: any }>(
        `${user_service}/api/user/update/resume`,
        formData,
        { headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" } }
      );
      toast.success("Resume updated!");
      if (data.updatedUser) setUser({ ...user, ...data.updatedUser } as any);
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to upload resume");
    } finally {
      setResumeLoading(false);
      setResumeFile(null);
    }
  };

  const addSkill = async () => {
    if (!skillName.trim()) return;
    const token = Cookies.get("token");
    try {
      const { data } = await axios.post<{ message: string }>(
        `${user_service}/api/user/skill/add`,
        { skillName },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      toast.success(data.message || "Skill added!");
      setSkills(prev => [...prev, skillName.trim()]);
      setSkillName("");
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to add skill");
    }
  };

  const deleteSkill = async (sName: string) => {
    const token = Cookies.get("token");
    try {
      const { data } = await axios.delete<{ message: string }>(
        `${user_service}/api/user/skill/delete`,
        { 
          data: { skillName: sName },
          headers: { Authorization: `Bearer ${token}` } 
        }
      );
      toast.success(data.message || "Skill deleted!");
      setSkills(prev => prev.filter(s => s !== sName));
    } catch (error: any) {
      toast.error(error.response?.data?.message || "Failed to delete skill");
    }
  };

  if (loading || !user) return <div className="text-center py-20">Loading...</div>;

  return (
    <div className="min-h-screen p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6">
        <Link href="/account" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft size={16} className="mr-2" /> Back to Account
        </Link>
        <div className="grid md:grid-cols-2 gap-8">
          <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-sm h-fit">
            <h1 className="text-2xl font-bold mb-6">General Info</h1>
            <form onSubmit={submitHandler} className="space-y-6">
              <div className="space-y-3">
                <Label htmlFor="name" className="text-sm font-medium">Full Name</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 opacity-50" />
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-10 h-11 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="phone" className="text-sm font-medium">Phone Number</Label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 opacity-50" />
                  <input
                    id="phone"
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-full pl-10 h-11 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <Label htmlFor="bio" className="text-sm font-medium">Bio</Label>
                <div className="relative">
                  <FileText className="absolute left-3 top-4 h-5 w-5 opacity-50" />
                  <textarea
                    id="bio"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={4}
                    className="w-full pl-10 rounded-md border border-input bg-transparent px-3 py-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>

              <Button disabled={btnLoading} className="w-full h-11 text-base">
                {btnLoading ? "Updating..." : "Save Changes"}
              </Button>
            </form>
          </div>

          <div className="space-y-8">
            <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-sm">
              <h2 className="text-xl font-bold mb-4">Profile Media</h2>
              <div className="space-y-6">
                <div>
                  <Label className="text-sm font-medium mb-2 block">Profile Picture</Label>
                  <div className="flex gap-2">
                    <input type="file" accept="image/*" onChange={(e) => setPicFile(e.target.files?.[0] || null)} className="border p-2 rounded-md w-full text-sm font-medium"/>
                    <Button onClick={uploadPic} disabled={picLoading}>
                      <Upload size={16} />
                    </Button>
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium mb-2 block">Resume (PDF)</Label>
                  <div className="flex gap-2">
                    <input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setResumeFile(e.target.files?.[0] || null)} className="border p-2 rounded-md w-full text-sm font-medium"/>
                    <Button onClick={uploadResume} disabled={resumeLoading}>
                      <Upload size={16} />
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border/50 rounded-2xl p-8 shadow-sm">
              <h2 className="text-xl font-bold mb-4">Skills & Strengths</h2>
              <div className="flex gap-2 mb-4">
                <input
                  type="text"
                  placeholder="e.g. React, Node.js"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSkill(); }}
                  className="w-full h-11 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                />
                <Button onClick={addSkill} className="h-11 px-4">
                  <Plus size={18} /> Add
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill, idx) => (
                  <span key={idx} className="flex items-center gap-1 bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-medium">
                    {skill}
                    <button onClick={() => deleteSkill(skill)} className="hover:text-red-500 opacity-70 hover:opacity-100 transition-all">
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditProfilePage;
