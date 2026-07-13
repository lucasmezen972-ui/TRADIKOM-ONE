import { AppShell } from "@/components/app-shell";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const [tenants, platformAdmin] = await Promise.all([
    services.getUserTenants(user.id),
    services.isPlatformAdmin(user.id),
  ]);

  return (
    <AppShell
      tenant={tenant}
      tenants={tenants}
      userName={user.name}
      platformAdmin={platformAdmin}
    >
      {children}
    </AppShell>
  );
}
