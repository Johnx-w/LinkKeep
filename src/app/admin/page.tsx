import {
  AdminDashboard,
  type DashboardData,
} from "@/components/admin-dashboard";
import { AdminLogin } from "@/components/admin-login";
import { requireAdmin } from "@/security/admin-request";
import { getStore } from "@/storage/server-store";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  let session: Awaited<ReturnType<typeof requireAdmin>> | null = null;
  try {
    session = await requireAdmin();
  } catch {
    session = null;
  }
  if (!session) return <AdminLogin />;

  const store = getStore();
  const month = new Date().toISOString().slice(0, 7);
  const initialData: DashboardData = {
    csrf: session.csrf,
    platforms: store.platformStatuses(),
    complaints: store.listOpenComplaints(),
    feedback: store.listOpenFeedback(),
    blockedPosts: store.blockedPosts(),
    proxyUsage: store.proxyUsage(month),
  };
  return <AdminDashboard initialData={initialData} />;
}
