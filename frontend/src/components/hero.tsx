import {
  ArrowRight,
  Briefcase,
  Building2,
  MapPin,
  Search,
  Sparkles,
  Star,
  TrendingUp,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import React from "react";
import { Button } from "./ui/button";

const Hero = () => {
  return (
    <section className="relative overflow-hidden pb-10 pt-8 sm:pt-12 lg:pb-20">
      <div className="shell">
        <div className="grid items-center gap-10 lg:grid-cols-[1.08fr_0.92fr] lg:gap-14">
          <div className="relative">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-card/80 px-4 py-2 text-sm font-medium shadow-sm backdrop-blur">
              <Sparkles size={16} className="text-primary" />
              AI-assisted job search for ambitious teams and candidates
            </div>

            <h1 className="max-w-3xl text-5xl font-bold leading-[0.98] tracking-tight sm:text-6xl lg:text-7xl">
              Build the next move in your career
              <span className="mt-2 block bg-gradient-to-r from-primary via-teal-500 to-amber-500 bg-clip-text text-transparent">
                with a portal that feels premium
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
              Find standout roles, sharpen your resume, and get guided by AI
              insights in one place. Designed for job seekers who want clarity
              and recruiters who want momentum.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link href="/jobs" className="w-full sm:w-auto">
                <Button
                  size="lg"
                  className="group h-14 w-full rounded-2xl bg-gradient-to-r from-primary via-teal-500 to-emerald-500 px-8 text-base font-semibold text-primary-foreground shadow-[0_20px_50px_-20px_rgba(13,148,136,0.6)] transition hover:scale-[1.01] sm:w-auto"
                >
                  <Search size={20} />
                  Explore Jobs
                  <ArrowRight
                    size={20}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </Button>
              </Link>
              <Link href="/about" className="w-full sm:w-auto">
                <Button
                  variant="outline"
                  size="lg"
                  className="h-14 w-full rounded-2xl border-border/70 bg-card/60 px-8 text-base shadow-sm backdrop-blur sm:w-auto"
                >
                  <Briefcase size={20} />
                  How it Works
                </Button>
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                { value: "12k+", label: "Live openings" },
                { value: "1.8k+", label: "Hiring teams" },
                { value: "92%", label: "Resume match accuracy" },
              ].map((item) => (
                <div key={item.label} className="glass-card rounded-3xl px-5 py-5">
                  <p className="text-3xl font-bold text-foreground">{item.value}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="glass-card relative overflow-hidden rounded-[2rem] p-3">
              <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-r from-primary/20 via-teal-400/20 to-amber-300/20" />
              <div className="absolute right-6 top-6 z-10 flex items-center gap-2 rounded-full bg-background/80 px-3 py-2 text-xs font-medium shadow-sm">
                <TrendingUp size={14} className="text-primary" />
                Candidate activity is trending up
              </div>

              <div className="relative overflow-hidden rounded-[1.6rem] border border-white/50">
                <Image
                  src="/Hero.png"
                  alt="Job portal dashboard preview"
                  width={1200}
                  height={1200}
                  className="h-[540px] w-full object-cover object-center"
                  priority
                />
              </div>

              <div className="absolute -left-3 bottom-10 rounded-3xl border border-white/60 bg-background/90 p-4 shadow-xl backdrop-blur dark:border-white/10">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600">
                    <Star size={22} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">Top Match Found</p>
                    <p className="text-xs text-muted-foreground">
                      Senior Product Designer at Nova Labs
                    </p>
                  </div>
                </div>
              </div>

              <div className="absolute -right-4 top-28 w-60 rounded-3xl border border-white/60 bg-background/88 p-4 shadow-xl backdrop-blur dark:border-white/10">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold">Quick snapshot</p>
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    Live
                  </span>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Building2 size={16} />
                    240+ verified employers
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin size={16} />
                    Remote, hybrid, and onsite filters
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Briefcase size={16} />
                    AI resume and career guidance built in
                  </div>
                </div>
              </div>
            </div>

            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-amber-300/40 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-8 left-8 h-32 w-32 rounded-full bg-primary/30 blur-3xl" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
