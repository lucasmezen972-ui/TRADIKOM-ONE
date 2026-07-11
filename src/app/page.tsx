import { redirect } from "next/navigation";
import { ArrowRight, Building2, KeyRound, Sparkles } from "lucide-react";
import { getCurrentSession } from "@/lib/session";
import { loginAction, registerAction, seedDemoAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getCurrentSession();
  if (session) {
    redirect("/aujourdhui");
  }

  return (
    <main className="min-h-screen bg-[#08111f] text-white">
      <div className="mx-auto grid min-h-screen max-w-7xl gap-10 px-5 py-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:px-8">
        <section className="max-w-3xl">
          <div className="mb-8 inline-flex items-center gap-3 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/75">
            <Building2 size={18} aria-hidden />
            TRADIKOM ONE
          </div>
          <h1 className="text-5xl font-bold leading-tight md:text-7xl">
            Donnez un cerveau a vos outils metier.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/70">
            Sites, leads, CRM, relances, connexions et activite commerciale
            dans un poste de pilotage clair pour les entreprises locales.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              "Site genere et publiable",
              "Lead transforme en tache",
              "Audit et isolation tenant",
            ].map((item) => (
              <div
                key={item}
                className="rounded-lg border border-white/10 bg-white/[0.06] p-4 text-sm text-white/80"
              >
                {item}
              </div>
            ))}
          </div>
          <form action={seedDemoAction} className="mt-8">
            <button className="inline-flex items-center gap-2 rounded-md bg-[#19c6b7] px-5 py-3 font-semibold text-[#08111f]">
              Ouvrir la demo Garage Caraibes Auto
              <Sparkles size={18} aria-hidden />
            </button>
          </form>
        </section>

        <section className="grid gap-4">
          <div className="rounded-lg bg-[#fffaf1] p-5 text-slate-950 shadow-2xl">
            <div className="mb-5 flex items-center gap-2">
              <KeyRound size={20} aria-hidden />
              <h2 className="text-xl font-bold">Creer un compte</h2>
            </div>
            <form action={registerAction} className="grid gap-3">
              <input
                required
                name="name"
                placeholder="Nom"
                className="rounded-md border border-slate-200 px-4 py-3"
              />
              <input
                required
                type="email"
                name="email"
                placeholder="Email professionnel"
                className="rounded-md border border-slate-200 px-4 py-3"
              />
              <input
                required
                minLength={8}
                type="password"
                name="password"
                placeholder="Mot de passe"
                className="rounded-md border border-slate-200 px-4 py-3"
              />
              <button className="inline-flex items-center justify-center gap-2 rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
                Continuer
                <ArrowRight size={18} aria-hidden />
              </button>
            </form>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
            <h2 className="text-lg font-bold">Connexion</h2>
            <form action={loginAction} className="mt-4 grid gap-3">
              <input
                required
                type="email"
                name="email"
                placeholder="patron@garage-caraibes-auto.example"
                className="rounded-md border border-white/10 bg-white px-4 py-3 text-slate-950"
              />
              <input
                required
                type="password"
                name="password"
                placeholder="Tradikom!2026"
                className="rounded-md border border-white/10 bg-white px-4 py-3 text-slate-950"
              />
              <button className="rounded-md bg-white px-5 py-3 font-semibold text-[#08111f]">
                Se connecter
              </button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
