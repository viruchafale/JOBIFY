"use client";

import CareerGuide from "@/components/career-guide";
import Hero from "@/components/hero";
import Loading from "@/components/loading";
import ResumeAnalyzer from "@/components/resume-analyzer";
import { useAppData } from "@/context/AppContext";
import {
  ArrowRight,
  Bot,
  Briefcase,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import Link from "next/link";
import React from "react";

const highlights = [
  {
    icon: Briefcase,
    title: "Curated job discovery",
    description:
      "Search roles with cleaner cards, clearer metadata, and a more focused browsing flow.",
  },
  {
    icon: Bot,
    title: "AI career guidance",
    description:
      "Turn your current skills into role suggestions and a learning roadmap you can actually act on.",
  },
  {
    icon: ScanSearch,
    title: "Resume readiness",
    description:
      "Upload a PDF and get a quick ATS snapshot with strengths and fixes that matter most.",
  },
];

const trustPoints = [
  "Designed for both job seekers and recruiters",
  "Fast search with title and location filters",
  "Modern responsive layout across desktop and mobile",
];

const Home = () => {
  const { loading } = useAppData();

  if (loading) return <Loading />;

  return (
    <div className="pb-16">
      <Hero />

      <section className="shell py-8 sm:py-12">
        <div className="glass-card rounded-[2rem] p-6 sm:p-8 lg:p-10">
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-4 py-2 text-sm font-medium">
                <Sparkles size={16} className="text-primary" />
                A more intentional first impression
              </div>
              <h2 className="mt-5 max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">
                Everything you need to move from browsing to applying
              </h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
                The portal now leans into a warmer editorial style with stronger
                hierarchy, more premium cards, and a clearer path into jobs and
                AI tools.
              </p>
              <div className="mt-6 space-y-3">
                {trustPoints.map((point) => (
                  <div
                    key={point}
                    className="flex items-center gap-3 text-sm sm:text-base"
                  >
                    <ShieldCheck size={18} className="text-primary" />
                    <span>{point}</span>
                  </div>
                ))}
              </div>
              <Link
                href="/jobs"
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-primary"
              >
                Start exploring jobs
                <ArrowRight size={16} />
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {highlights.map(({ icon: Icon, title, description }) => (
                <div
                  key={title}
                  className="rounded-[1.75rem] border border-border/60 bg-background/80 p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg"
                >
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-amber-300/40 text-primary">
                    <Icon size={22} />
                  </div>
                  <h3 className="text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <CareerGuide />
      <ResumeAnalyzer />

      <section className="shell pt-8">
        <div className="rounded-[2rem] border border-border/70 bg-gradient-to-r from-slate-900 via-teal-950 to-slate-900 px-6 py-8 text-white shadow-[0_24px_80px_-40px_rgba(15,23,42,0.8)] sm:px-8 lg:flex lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm">
              <Target size={16} />
              Ready to find your next role?
            </div>
            <h2 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
              Browse openings, refine your resume, and apply with more
              confidence.
            </h2>
          </div>
          <div className="mt-6 lg:mt-0">
            <Link href="/jobs">
              <span className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition hover:scale-[1.02]">
                View jobs
                <ArrowRight size={16} />
              </span>
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Home;
