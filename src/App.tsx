/// <reference types="vite-plugin-pages/client-react" />

import { Suspense } from "react";
import { useRoutes, useLocation, Navigate } from "react-router-dom";
import routes from "~react-pages";
import { useAuth } from "./hooks/auth-context";

function Loading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center font-bold">
      Loading...
    </div>
  );
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const { pathname } = useLocation();

  const isAppRoute = pathname.startsWith("/app");
  const isAuthRoute = pathname === "/auth";

  if (loading && (isAppRoute || isAuthRoute)) return <Loading />;
  if (isAppRoute && !isAuthenticated) return <Navigate to="/auth" replace />;
  if (isAuthRoute && isAuthenticated) return <Navigate to="/app" replace />;

  return <>{children}</>;
}

export default function App() {
  const element = useRoutes(routes);

  return (
    <Suspense fallback={<Loading />}>
      <AuthGuard>{element}</AuthGuard>
    </Suspense>
  );
}
