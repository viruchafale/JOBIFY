"use client";
import { User } from "@/type";
import { useParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import Loading from "@/components/loading";
import Info from "../components/info";

const UserAccount = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { id } = useParams();
  async function fetchUser() {
    try {
      const data = await api.user.getProfile(id as string);
      setUser(data);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    fetchUser();
  }, [id]);
  
  if (loading) return <Loading />;
  
  return (
    <div className="w-[90%] md:w-[60%] m-auto">
      {user ? <Info user={user} isYourAccount={false}/> : <div className="text-center py-20 text-muted-foreground">User not found</div>}
    </div>
  );
};

export default UserAccount;
