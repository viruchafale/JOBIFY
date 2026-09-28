"use client";
import React, { useEffect, useState, createContext, useContext } from "react";
import type { AppContextType, AppProviderProps, User } from "@/type";
import toast, { Toaster } from "react-hot-toast";
import { api } from "@/lib/api";

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuth, setIsAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [btnLoading, setBtnLoading] = useState(false);

  async function fetchUser() {
    try {
      const data = await api.user.getMe();
      setUser(data);
      setIsAuth(true);
    } catch (error) {
      setUser(null);
      setIsAuth(false);
    } finally {
      setLoading(false);
    }
  }

  async function logoutUser() {
    try {
      await api.auth.logout();
      setUser(null);
      setIsAuth(false);
      toast.success("Logged out successfully");
    } catch (error) {
      toast.error("Failed to log out");
    }
  }

  useEffect(() => {
    fetchUser();
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        loading,
        btnLoading,
        isAuth,
        setIsAuth,
        setUser,
        setLoading,
        logoutUser,
      }}
    >
      {children}
      <Toaster />
    </AppContext.Provider>
  );
};

export const useAppData = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useAppData must be used within AppProvider");
  }
  return context;
};
