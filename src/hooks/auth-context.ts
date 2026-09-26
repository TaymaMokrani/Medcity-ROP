import { createContext, useContext } from "react";
import type { UserPayload } from "@/lib/auth";

export interface AuthState {
  user: UserPayload | null;
  loading: boolean;
  isAuthenticated: boolean;
  signIn: (token: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
