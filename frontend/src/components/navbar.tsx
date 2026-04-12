"use client";

import Link from "next/link";
import React, { useState } from "react";
import {
  ArrowRight,
  Briefcase,
  Home,
  Info,
  LogOut,
  Menu,
  User,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { ModeToggle } from "./mode-toggle";
import { useAppData } from "@/context/AppContext";

const navItems = [
  { href: "/", label: "Home", icon: Home },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/about", label: "About", icon: Info },
];

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { isAuth, user, loading, logoutUser } = useAppData();

  const toggleMenu = () => {
    setIsOpen((prev) => !prev);
  };

  const closeMenu = () => {
    setIsOpen(false);
  };

  const logoutHandler = () => {
    logoutUser();
    closeMenu();
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="shell">
        <div className="flex min-h-20 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-primary via-teal-500 to-amber-400 text-lg font-black text-primary-foreground shadow-lg shadow-primary/20">
              J
            </div>
            <div>
              <div className="text-lg font-bold tracking-tight">JobiFy</div>
              <div className="text-xs text-muted-foreground">
                Modern job discovery for ambitious teams
              </div>
            </div>
          </Link>

          <div className="hidden items-center rounded-full border border-border/70 bg-card/80 p-1 shadow-sm md:flex">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link href={href} key={href}>
                <Button
                  variant="ghost"
                  className="rounded-full px-4 text-sm font-medium"
                >
                  <Icon size={16} />
                  {label}
                </Button>
              </Link>
            ))}
            {isAuth && user?.role === "recruiter" && (
              <Link href="/recruiter/jobs/new">
                <Button className="rounded-full px-4 text-sm font-semibold shadow-sm">
                  Post Job
                  <ArrowRight size={16} />
                </Button>
              </Link>
            )}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            {!loading &&
              (isAuth ? (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="flex items-center gap-3 rounded-full border border-border/60 bg-card/70 px-2 py-1 pr-3 transition hover:border-primary/40 hover:bg-card">
                      <Avatar className="h-9 w-9 ring-2 ring-primary/15">
                        <AvatarImage
                          src={user ? (user.profile_pic as string) : ""}
                          alt={user ? user.name : ""}
                        />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {user?.name?.charAt(0).toUpperCase() || "U"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="text-left">
                        <p className="text-sm font-semibold leading-none">
                          {user?.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {user?.role}
                        </p>
                      </div>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 rounded-2xl p-2" align="end">
                    <div className="mb-2 rounded-xl bg-muted/60 px-3 py-3">
                      <p className="text-sm font-semibold">{user?.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                    <Link href="/account">
                      <Button
                        className="h-10 w-full justify-start gap-2 rounded-xl"
                        variant="ghost"
                      >
                        <User size={16} />
                        Profile
                      </Button>
                    </Link>
                    {user?.role === "jobseeker" && (
                      <Link href="/account/applications">
                        <Button
                          className="h-10 w-full justify-start gap-2 rounded-xl"
                          variant="ghost"
                        >
                          <Briefcase size={16} />
                          Applications
                        </Button>
                      </Link>
                    )}
                    {user?.role === "recruiter" && (
                      <Link href="/recruiter/applications">
                        <Button
                          className="h-10 w-full justify-start gap-2 rounded-xl"
                          variant="ghost"
                        >
                          <Briefcase size={16} />
                          Dashboard
                        </Button>
                      </Link>
                    )}
                    <Button
                      className="mt-1 h-10 w-full justify-start gap-2 rounded-xl text-red-500 hover:bg-red-500/10 hover:text-red-600"
                      variant="ghost"
                      onClick={logoutHandler}
                    >
                      <LogOut size={16} />
                      Logout
                    </Button>
                  </PopoverContent>
                </Popover>
              ) : (
                <Link href="/auth/login">
                  <Button className="rounded-full px-5 shadow-sm">
                    <User size={16} />
                    Sign In
                  </Button>
                </Link>
              ))}
            <ModeToggle />
          </div>

          <div className="flex items-center gap-3 md:hidden">
            <ModeToggle />
            <button
              className="rounded-xl border border-border/60 bg-card/80 p-2 transition-colors hover:bg-accent"
              aria-label="Toggle menu"
              onClick={toggleMenu}
            >
              {isOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
        </div>
      </div>

      <div
        className={`overflow-hidden border-t transition-all duration-300 ease-in-out md:hidden ${isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="shell py-4">
          <div className="glass-card space-y-2 rounded-3xl p-3">
            {navItems.map(({ href, label, icon: Icon }) => (
              <Link href={href} key={href} onClick={closeMenu}>
                <Button
                  variant="ghost"
                  className="h-11 w-full justify-start gap-3 rounded-2xl"
                >
                  <Icon size={18} />
                  {label}
                </Button>
              </Link>
            ))}

            {isAuth && user?.role === "recruiter" && (
              <Link href="/recruiter/jobs/new" onClick={closeMenu}>
                <Button className="h-11 w-full justify-start gap-3 rounded-2xl">
                  <Briefcase size={18} />
                  Post Job
                </Button>
              </Link>
            )}

            {isAuth ? (
              <>
                <Link href="/account" onClick={closeMenu}>
                  <Button
                    className="h-11 w-full justify-start gap-3 rounded-2xl"
                    variant="ghost"
                  >
                    <User size={18} />
                    My Profile
                  </Button>
                </Link>
                <Button
                  variant="ghost"
                  className="h-11 w-full justify-start gap-3 rounded-2xl text-red-500 hover:bg-red-500/10 hover:text-red-600"
                  onClick={logoutHandler}
                >
                  <LogOut size={18} />
                  Logout
                </Button>
              </>
            ) : (
              <Link href="/auth/login" onClick={closeMenu}>
                <Button className="h-11 w-full justify-start gap-3 rounded-2xl">
                  <User size={18} />
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
