"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";

export function SiteHeader() {
  const { user, logout, ready } = useAuth();
  const router = useRouter();

  return (
    <header className="site-header">
      <div className="inner">
        <Link href="/" className="brand">
          Movie RAG
        </Link>
        {ready && user ? (
          <>
            <nav aria-label="Main">
              <Link href="/documents">Documents</Link>
              <Link href="/chat">Chat</Link>
            </nav>
            <span className="spacer" />
            <span className="who">{user.email}</span>
            <button
              onClick={() => {
                logout();
                router.push("/login");
              }}
            >
              Sign out
            </button>
          </>
        ) : null}
      </div>
    </header>
  );
}
