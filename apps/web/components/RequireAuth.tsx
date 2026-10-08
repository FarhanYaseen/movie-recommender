"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

// Client-side guard: app pages render nothing until the stored session has
// been read, then redirect signed-out visitors to /login.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { token, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !token) {
      router.replace("/login");
    }
  }, [ready, token, router]);

  if (!ready || !token) {
    return null;
  }
  return <>{children}</>;
}
