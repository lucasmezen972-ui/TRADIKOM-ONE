import Link from "next/link";
import {
  Activity,
  BarChart3,
  BadgeEuro,
  Binoculars,
  BrainCircuit,
  Bot,
  Building2,
  Contact,
  Gauge,
  Globe2,
  Lightbulb,
  LibraryBig,
  Megaphone,
  PackageSearch,
  ScanSearch,
  PlugZap,
  Settings,
  Star,
  WalletCards,
  UsersRound,
  Workflow,
} from "lucide-react";
import type { Tenant } from "@/lib/types";
import { switchTenantAction, logoutAction } from "@/app/actions";

type AppShellProps = {
  children: React.ReactNode;
  tenant: Tenant;
  tenants: Array<{ tenant: Tenant }>;
  userName: string;
  platformAdmin: boolean;
};

const navItems = [
  { href: "/aujourdhui", label: "Aujourd'hui", icon: Gauge },
  {
    href: "/cerveau-entreprise",
    label: "Cerveau d'entreprise",
    icon: BrainCircuit,
  },
  { href: "/conseiller-strategique", label: "Conseiller", icon: Lightbulb },
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/mon-activite", label: "Mon activité", icon: Activity },
  { href: "/contacts", label: "Contacts", icon: Contact },
  { href: "/opportunites", label: "Opportunités", icon: BarChart3 },
  { href: "/assistant-commercial", label: "Assistant commercial", icon: BadgeEuro },
  { href: "/reputation", label: "Réputation", icon: Star },
  { href: "/veille-concurrentielle", label: "Veille concurrents", icon: Binoculars },
  { href: "/pilotage-financier", label: "Pilotage financier", icon: WalletCards },
  { href: "/equipe-ia", label: "Équipe IA", icon: UsersRound },
  { href: "/mon-site", label: "Mon site", icon: Globe2 },
  { href: "/automatisations", label: "Automatisations", icon: Workflow },
  { href: "/connexions", label: "Connexions", icon: PlugZap },
  { href: "/catalogue", label: "Catalogue privé", icon: PackageSearch },
  {
    href: "/bibliotheque-automatisations",
    label: "Bibliothèque",
    icon: LibraryBig,
  },
  { href: "/resultats", label: "Résultats", icon: Bot },
  { href: "/parametres", label: "Paramètres", icon: Settings },
];

export function AppShell({
  children,
  tenant,
  tenants,
  userName,
  platformAdmin,
}: AppShellProps) {
  const visibleNavItems = platformAdmin
    ? [
        ...navItems,
        { href: "/intelligence-api", label: "Intelligence API", icon: ScanSearch },
      ]
    : navItems;
  return (
    <div className="min-h-screen bg-[#08111f] text-slate-100">
      <aside className="fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-white/10 bg-[#08111f] p-5 lg:flex">
        <Link href="/aujourdhui" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-[#19c6b7] text-[#08111f]">
            <Building2 size={20} aria-hidden />
          </span>
          <span>
            <span className="block text-sm font-semibold uppercase tracking-[0.16em] text-white/60">
              TRADIKOM
            </span>
            <span className="text-xl font-bold">ONE</span>
          </span>
        </Link>

        <form action={switchTenantAction} className="mt-8">
          <label htmlFor="tenantId" className="text-xs uppercase tracking-[0.16em] text-white/50">
            Organisation
          </label>
          <select
            id="tenantId"
            name="tenantId"
            defaultValue={tenant.id}
            className="mt-2 w-full rounded-md border border-white/10 bg-white/10 px-3 py-2 text-sm text-white"
          >
            {tenants.map((item) => (
              <option key={item.tenant.id} value={item.tenant.id} className="text-slate-950">
                {item.tenant.name}
              </option>
            ))}
          </select>
          <button className="mt-2 w-full rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15">
            Changer
          </button>
        </form>

        <nav className="mt-8 grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-white/72 hover:bg-white/10 hover:text-white"
              >
                <Icon size={18} aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <form action={logoutAction} className="mt-4 shrink-0 border-t border-white/10 pt-4">
          <p className="mb-3 text-sm text-white/55">{userName}</p>
          <button className="w-full rounded-md border border-white/10 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10">
            Déconnexion
          </button>
        </form>
      </aside>

      <main className="min-h-screen bg-[#f6f1e8] text-slate-950 lg:pl-72">
        <div className="border-b border-slate-200 bg-[#fffaf1]/90 px-5 py-4 lg:hidden">
          <div className="flex items-center justify-between">
            <Link href="/aujourdhui" className="font-bold">
              TRADIKOM ONE
            </Link>
            <span className="text-sm text-slate-600">{tenant.name}</span>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {visibleNavItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-md bg-white px-3 py-2 text-sm shadow-sm"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl px-5 py-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
