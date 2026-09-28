import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AccountProps, User } from "@/type";
import { useAppData } from "@/context/AppContext";
import { api } from "@/lib/api";
import {
  Briefcase,
  Camera,
  FileText,
  Mail,
  NotepadText,
  Phone,
  Settings,
} from "lucide-react";
import Link from "next/link";
import React, { ChangeEvent, useRef, useState } from "react";
import toast from "react-hot-toast";
import Image from "next/image";

const Info: React.FC<AccountProps> = ({ user, isYourAccount }) => {
  const { setUser } = useAppData();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingPic, setUploadingPic] = useState(false);

  // Click on camera triggers file input
  const handleClick = () => {
    inputRef.current?.click();
  };

  // Upload handler for profile picture
  const changeHandler = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith("image/")) {
        toast.error("Please select a valid image file");
        return;
      }

      setUploadingPic(true);
      const formData = new FormData();
      formData.append("file", file);

      try {
        const data = await api.user.updateProfilePic(formData);
        toast.success("Profile picture updated!");
        if (data.updatedUser && isYourAccount) {
          setUser((prev) => ({ ...prev, ...data.updatedUser } as User));
        }
      } catch (error: any) {
        toast.error(error.response?.data?.message || "Failed to update profile picture");
      } finally {
        setUploadingPic(false);
      }
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-10 px-4 md:px-0">
      <Card className="overflow-hidden shadow-2xl border-0 bg-card/60 backdrop-blur-3xl rounded-3xl relative">
        {/* Banner Section */}
        <div className="h-48 md:h-64 bg-gradient-to-r from-primary/80 via-blue-600/80 to-indigo-600/80 relative">
           <div className="absolute inset-0 bg-[url('/noise.png')] opacity-20 mix-blend-overlay"></div>
        </div>
        
        <div className="px-6 md:px-12 pb-12">
          {/* Avatar positioning */}
          <div className="relative flex justify-between items-end -mt-16 md:-mt-20 mb-8">
            <div className="relative group">
              <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-[6px] border-background overflow-hidden relative shadow-2xl bg-muted">
                {uploadingPic && (
                  <div className="absolute inset-0 z-10 bg-black/50 flex flex-col items-center justify-center">
                    <div className="w-6 h-6 border-2 border-white rounded-full border-t-transparent animate-spin"></div>
                  </div>
                )}
                <Image
                  src={user.profile_pic ? user.profile_pic : "/user_avatar.png"}
                  alt="user_profile"
                  className="w-full h-full object-cover"
                  width={256}
                  height={256}
                />
              </div>

              {/* Edit pic button */}
              {isYourAccount && (
                <>
                  <input
                    type="file"
                    className="hidden"
                    ref={inputRef}
                    accept="image/*"
                    onChange={changeHandler}
                  />
                  <button
                    onClick={handleClick}
                    disabled={uploadingPic}
                    title="Change Profile Picture"
                    className="absolute bottom-2 right-2 rounded-full h-10 w-10 bg-primary text-primary-foreground shadow-xl flex items-center justify-center hover:scale-105 hover:bg-blue-600 transition-all z-20"
                  >
                    <Camera size={18} />
                  </button>
                </>
              )}
            </div>
            
            {/* Action buttons mapping */}
            {isYourAccount && (
              <div className="mb-4">
                <Link href="/account/edit">
                  <Button className="rounded-full shadow-lg h-12 px-6 gap-2 bg-background text-foreground hover:bg-muted border border-border">
                    <Settings size={18} className="text-primary"/> Edit Profile
                  </Button>
                </Link>
              </div>
            )}
          </div>

          <div className="space-y-12">
            {/* Header info */}
            <div>
              <h1 className="text-4xl md:text-5xl font-black mb-2">{user.name}</h1>
              <div className="flex items-center gap-2 text-primary font-medium text-lg">
                <Briefcase size={20} />
                <span className="capitalize">{user.role}</span>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {/* Left Column */}
              <div className="space-y-8">
                 {/* Bio Section */}
                <div className="p-6 rounded-2xl bg-background/50 border border-border/50 shadow-sm leading-relaxed">
                  <h2 className="text-sm uppercase tracking-widest text-muted-foreground font-semibold mb-4 flex items-center gap-2">
                    <FileText size={16} className="text-primary"/> About Me
                  </h2>
                  <p className="text-foreground/90">
                    {user.bio ? user.bio : "This user has not provided a biographical description."}
                  </p>
                </div>

                {/* Skills Section */}
                <div className="p-6 rounded-2xl bg-background/50 border border-border/50 shadow-sm">
                  <h2 className="text-sm uppercase tracking-widest text-muted-foreground font-semibold mb-4">
                    Top Skills
                  </h2>
                  {user.skills && user.skills.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {user.skills.map((skill, index) => (
                        <span key={index} className="px-4 py-2 bg-primary/10 text-primary rounded-xl text-sm font-medium border border-primary/20">
                          {skill}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No skills added yet.</p>
                  )}
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-8">
                {/* Contact Information */}
                <div className="p-6 rounded-2xl bg-background/50 border border-border/50 shadow-sm">
                  <h2 className="text-sm uppercase tracking-widest text-muted-foreground font-semibold mb-6">
                    Contact Details
                  </h2>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 group">
                      <div className="h-12 w-12 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-600 group-hover:scale-110 group-hover:bg-blue-600 group-hover:text-white transition-all duration-300">
                        <Mail size={20} />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase font-medium">Email Address</p>
                        <p className="text-foreground font-medium">{user.email}</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 group">
                      <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-600 group-hover:scale-110 group-hover:bg-emerald-600 group-hover:text-white transition-all duration-300">
                        <Phone size={20} />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase font-medium">Phone Number</p>
                        <p className="text-foreground font-medium">{user.phone_number || "Not provided"}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Resume Section */}
                {user.role === "jobseeker" && (
                  <div className="p-6 rounded-2xl bg-background/50 border border-border/50 shadow-sm">
                    <h2 className="text-sm uppercase tracking-widest text-muted-foreground font-semibold mb-6 flex items-center gap-2">
                       <NotepadText size={16} className="text-primary"/> Professional Resume
                    </h2>
                    
                    {user.resume ? (
                      <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:border-primary/50 transition-colors group">
                         <div className="flex items-center gap-4">
                           <div className="h-10 w-10 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500">
                             <NotepadText size={20} />
                           </div>
                           <div>
                             <p className="text-sm font-medium">{user.name}'s Resume.pdf</p>
                             <p className="text-xs text-muted-foreground">Click to view document</p>
                           </div>
                         </div>
                         <Link href={user.resume} target="_blank">
                           <Button variant="secondary" size="sm" className="rounded-full shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">Open</Button>
                         </Link>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground p-4 text-center border-2 border-dashed border-border rounded-xl">No resume uploaded</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            
          </div>
        </div>
      </Card>
    </div>
  );
};

export default Info;
