"use client";
import { CareerGuideResponse, utils_service } from "@/type";
import {
  ArrowRight,
  Briefcase,
  Lightbulb,
  Loader2,
  Sparkle,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import axios from "axios";

const CareerGuide = () => {
  const [open, setOpen] = useState(false);
  const [skills, setSkills] = useState<string[]>([]);
  const [currentSkills, setCurrentSkills] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<CareerGuideResponse | null>(null);

  const addSkills = () => {
    if (currentSkills.trim() && !skills.includes(currentSkills.trim())) {
      setSkills([...skills, currentSkills.trim()]);
      setCurrentSkills("");
    }
  };
  const removeSkills = (skillsToRemove: string) => {
    setSkills(skills.filter((s) => s !== skillsToRemove));
  };
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      addSkills();
    }
  };
  const getCareerGuidance = async () => {
    if (skills.length === 0) {
      alert("Please add at least one skills");
      return;
    }
    setLoading(true);
    try {
      const { data } = await axios.post<CareerGuideResponse>(
        `${utils_service}/api/utils/career`,
        {
          skills: skills,
        },
      );
      setResponse(data);
      alert("Career guidance generated");
    } catch (error) {
      console.log("Failed to get career guidance ", error);
      alert("Failed to get career guidance");
    } finally {
      setLoading(false);
    }
  };
  const resetDialog = () => {
    setSkills([]);
    setCurrentSkills("");
    setResponse(null);
    setOpen(false);
  };
  return (
    <div className="max-w-7xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border bg-blue-50 dark:bg-blue-950 mb-4">
          <Sparkles size={16} className="text-blue-600" />
          <span className="text-sm font-medium">
            {" "}
            AI-Powered Career Guidance
          </span>
        </div>
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Discover Your Career Path
        </h2>
        <p className="text-lg opacity-70 max-w-2xl mx-auto mb-8">
          get personalized job recommendation and learning roadmaps based on
          your skills
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size={"lg"} className="gap-2 h-12 px-8">
              <Sparkle size={18} />
              Get Career Guidance <ArrowRight size={18} />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
            {!response ? (
              <>
                <DialogHeader>
                  <DialogTitle className="text-2xl flex items-center gap-2">
                    <Sparkles className="text-blue-600" />
                    Tells us about your skills
                  </DialogTitle>
                  <DialogDescription>
                    Add your technical skills to receive personalized career
                    recommendation
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="skill">Add Skills</Label>
                    <div className="flex gap-2">
                      <Input
                        id="skill"
                        placeholder="e.g., React,Node.js,python..."
                        value={currentSkills}
                        onChange={(e) => setCurrentSkills(e.target.value)}
                        onKeyPress={handleKeyPress}
                        className="h-11"
                      />
                      <Button onClick={addSkills} className="gap-2">
                        Add
                      </Button>
                    </div>
                  </div>
                  {skills.length > 0 && (
                    <div className="space-y-2">
                      <Label>Your Skills ({skills.length})</Label>
                      <div className="flex flex-wrap gap-2">
                        {skills.map((s) => (
                          <div
                            key={s}
                            className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-full bg-blue-100 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800"
                          >
                            <span className="text-sm font-medium">{s}</span>
                            <button
                              onClick={() => removeSkills(s)}
                              className="h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center
"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <Button
                    onClick={getCareerGuidance}
                    disabled={loading || skills.length === 0}
                    className="w-full h-11 gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        Analyzing your skills....
                      </>
                    ) : (
                      <>
                        <Sparkle size={18} />
                        Generate career Guidance
                      </>
                    )}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle
                    className="text-2xl flex items-center gap-2
                "
                  >
                    <Target className="text-blue-600" />
                    Your Personalized Career Guide
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-6 py-4">
                  {/* summary */}
                  <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-b-blue-800">
                    <Lightbulb
                      className="text-blur600 mt-1 shrink-0 "
                      size={20}
                    />
                    <div>
                      <h3>Career Summary</h3>
                      <p className="text-sm leading-relaxed opacity-90">
                        {response.summary}
                      </p>
                    </div>
                  </div>
                  {/* job options */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <Briefcase size={20} className="text-blue-600" />
                      Recommended Career paths
                    </h3>
                    <div className="space-y-3">
                      {response.jobOptions.map((job, index) => (
                        <div
                          className="p-4 rounded-lg border hover:border-blue-500 transition-colors"
                          key={index}
                        ></div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default CareerGuide;
