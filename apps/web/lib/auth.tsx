"use client";

// Token storage: kept in React state (memory) and mirrored to sessionStorage
// so a page refresh within the tab keeps the session. Trade-off, documented in
// apps/web/README.md: sessionStorage is readable by any script running on this
// origin, so an XSS hole would expose the token. We accept this for the local
// demo because (a) the app renders all remote content as text, never HTML, and
// (b) tokens expire. A production deployment should prefer httpOnly cookies
// set by the backend.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "movie-rag-session";

export interface SessionUser {
  id: string;
  email: string;
}

interface Session {
  token: string;
  user: SessionUser;
}

interface AuthContextValue {
  token: string | null;
  user: SessionUser | null;
  /** False until the first client render has read sessionStorage. */
  ready: boolean;
  login(token: string, user: SessionUser): void;
  logout(): void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredSession(): Session | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Session;
    if (typeof parsed?.token === "string" && parsed?.user?.id) {
      return parsed;
    }
  } catch {
    // Blocked or corrupted storage — treat as signed out.
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(readStoredSession());
    setReady(true);
  }, []);

  const login = useCallback((token: string, user: SessionUser) => {
    const next = { token, user };
    setSession(next);
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Memory-only session when storage is unavailable.
    }
  }, []);

  const logout = useCallback(() => {
    setSession(null);
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures on logout.
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      token: session?.token ?? null,
      user: session?.user ?? null,
      ready,
      login,
      logout,
    }),
    [session, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
