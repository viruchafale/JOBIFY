"use client";
import { CareerGuideResponse } from "@/type";
import {
  ArrowRight,
  BookOpen,
  Briefcase,
  Lightbulb,
  Loader2,
  Sparkle,
  Sparkles,
  Target,
  TrendingUp,
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
import { api } from "@/lib/api";
import toast from "react-hot-toast";

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
      const data = await api.utils.careerGuide(skills);
      setResponse(data as any);
      toast.success("Career guidance generated");
    } catch (error) {
      console.log("Failed to get career guidance ", error);
      toast.error("Failed to get career guidance");
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
    <section className="shell py-16">
      <div className="rounded-[2rem] border border-border/60 bg-gradient-to-br from-background via-card to-secondary/40 p-6 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.35)] sm:p-8 lg:p-10">
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-4 py-2 mb-4">
          <Sparkles size={16} className="text-primary" />
          <span className="text-sm font-medium">
            AI-Powered Career Guidance
          </span>
        </div>
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          Discover Your Career Path
        </h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
          Get personalized job recommendations and a practical learning roadmap
          based on the skills you already have.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size={"lg"} className="gap-2 h-12 px-8 rounded-2xl shadow-sm">
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
                              className="h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center"
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
                  <DialogTitle className="text-2xl flex items-center gap-2">
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
                        >
                          <h4 className="font-semibold text-base mb-2">
                            {job.title}
                          </h4>
                          <div className="space-y-2 text-sm">
                            <div className="">
                              <span className="font-medium opacity-70">
                                Responsibilities:
                              </span>
                              <span className="opacity-80">{job.why}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* skills to learn  */}
                  <div>
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <TrendingUp size={20} className="text-blue-600" />
                      Skills to enhance your career
                    </h3>
                    <div className="space-y-4">
                      {response.skillsToLearn.map((category, index) => (
                        <div key={index} className="space-y-2">
                          <h4 className="font-semibold text-sm text-blue-600">
                            {category.category}
                          </h4>
                          <div className="space-y-2">
                            {category.skills.map((skill, sindex) => (
                              <div
                                key={sindex}
                                className="p-3 rounded-lg bg-secondary border text-sm"
                              >
                                <p className="font-medium mb-1">
                                  {skill.title}
                                </p>
                                <p className="text-xs opacity-70 mb-1">
                                  <span className="font-medium">why:</span>
                                  {skill.why}
                                </p>
                                <p className="text-xs opacity-70 mb-1">
                                  <span className="font-medium">How:</span>
                                  {skill.how}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* learning approach */}
                  <div className="p-4 rounded-lg border bg-blue-50 dark:bg-blue-950/20">
                    <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                      <BookOpen size={20} className="text-blue-600" />
                      {response.learningApproach.title}
                    </h3>
                    <ul className="space-y-2">
                      {response.learningApproach.points.map((point, index) => (
                        <li
                          key={index}
                          className="text-sm flex items-start gap-2"
                        >
                          <span className="text-blue-600 mt-0.5">·</span>
                          <span
                            className=""
                            dangerouslySetInnerHTML={{ __html: point }}
                          ></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <Button
                    onClick={resetDialog}
                    variant={"outline"}
                    className="w-full"
                  >
                    start New Analysis
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </section>
  );
};

export default CareerGuide;
