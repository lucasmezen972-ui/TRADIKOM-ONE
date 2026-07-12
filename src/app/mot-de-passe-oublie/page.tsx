import Link from "next/link";
import { Mail } from "lucide-react";
import { requestPasswordResetAction } from "@/app/actions";

export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#08111f] px-5 py-10 text-white">
      <section className="w-full max-w-md rounded-lg bg-[#fffaf1] p-6 text-slate-950 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-[#19c6b7] text-[#08111f]">
            <Mail size={20} aria-hidden />
          </span>
          <div>
            <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
              Accès
            </p>
            <h1 className="text-2xl font-bold">Mot de passe oublié</h1>
          </div>
        </div>
        <form action={requestPasswordResetAction} className="grid gap-4">
          <label className="grid gap-2">
            <span className="font-semibold">Email professionnel</span>
            <input
              required
              type="email"
              name="email"
              placeholder="vous@entreprise.com"
              className="rounded-md border border-slate-200 px-4 py-3"
            />
          </label>
          <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
            Recevoir un lien sécurisé
          </button>
        </form>
        <Link href="/" className="mt-5 block text-sm font-semibold text-slate-600">
          Retour à la connexion
        </Link>
      </section>
    </main>
  );
}
