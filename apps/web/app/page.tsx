"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { token, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) {
      return;
    }
    router.replace(token ? "/documents" : "/login");
  }, [ready, token, router]);

  return null;
}
