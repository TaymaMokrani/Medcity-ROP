import AppPage from "@/components/app/AppPage";
import Dashboard from "@/components/app/Dashboard";
import { useTitle } from "@/hooks/useTitle";

export default function DashboardPage() {
  useTitle("Dashboard");
  return (
    <AppPage>
      <Dashboard />
    </AppPage>
  );
}
