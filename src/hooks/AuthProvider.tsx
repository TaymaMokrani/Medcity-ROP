import { useEffect, useState, type ReactNode } from "react";
import {
  getUser,
  setToken,
  clearToken,
  isAuthenticated as hasValidToken,
  type UserPayload,
} from "@/lib/auth";
import { apiGet, setSessionExpiredHandler } from "@/lib/api";
import { clearAssets } from "@/lib/assets";
import { AuthContext } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      // Patient photographs downloaded during the session are held in memory
      // as blob URLs. They have to go with the session, or the next person at
      // this machine opens a tab still holding the last doctor's images.
      clearAssets();
      setUser(null);
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (!hasValidToken()) {
        clearToken();
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      try {
        const me = await apiGet<UserPayload>("/auth/me");
        if (!cancelled) setUser(me);
      } catch {
        clearToken();
        if (!cancelled) setUser(null);
      }

      if (!cancelled) setLoading(false);
    }

    verify();
    return () => {
      cancelled = true;
    };
  }, []);

  function signIn(token: string) {
    setToken(token);
    setUser(getUser());
  }

  function logout() {
    clearToken();
    clearAssets();
    setUser(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, isAuthenticated: !!user, signIn, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}
