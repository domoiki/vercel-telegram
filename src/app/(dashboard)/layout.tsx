import { AppShell } from "@/components/layout/app-shell";
import { getSystemHealth } from "@/lib/health";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const health = await getSystemHealth();
  return <AppShell health={health}>{children}</AppShell>;
}
