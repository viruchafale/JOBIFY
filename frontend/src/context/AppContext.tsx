"use client";
import React, { useEffect, useState } from "react";

import { ApiResponse, AppContextType, AppProviderProps, User } from "@/type";
import { createContext, useContext } from "react";
import toast, { Toaster } from "react-hot-toast";
export const utils_service = "http://51.20.37.105:5005";
export const auth_service = "http://51.20.37.105:5002";
export const user_service = "http://51.20.37.105:5006";
export const job_service = "http://51.20.37.105:5007";
import Cookies from "js-cookie";
import axios from "axios";

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuth, setIsAuth] = useState(false);
  const [loading, setLoading] = useState(true);
  const [btnLoading, setBtnLoading] = useState(false);

  const token = Cookies.get("token");
  async function fetchUser() {
    try {
      const { data } = await axios.get<User>(
        `${user_service}/api/user/me`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      setUser(data);
      setIsAuth(true);
    } catch (error) {
      console.log(error);
      setIsAuth(false)
    }finally{
      setLoading(false)
    }
  }

  async function logoutUser(){
    Cookies.set("token","")
    setUser(null)
    setIsAuth(false)
    toast.success("Logged out successfully ")


  }
  useEffect(()=>{
    fetchUser()
  },[])
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
        logoutUser
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
