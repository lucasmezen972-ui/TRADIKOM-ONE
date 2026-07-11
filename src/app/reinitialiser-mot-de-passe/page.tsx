import Link from "next/link";
import { KeyRound } from "lucide-react";
import { resetPasswordAction } from "@/app/actions";

export const dynamic = "force-dynamic";

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const token = params.token ?? "";

  return (
    <main className="grid min-h-screen place-items-center bg-[#08111f] px-5 py-10 text-white">
      <section className="w-full max-w-md rounded-lg bg-[#fffaf1] p-6 text-slate-950 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-[#19c6b7] text-[#08111f]">
            <KeyRound size={20} aria-hidden />
          </span>
          <div>
            <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
              Sécurité
            </p>
            <h1 className="text-2xl font-bold">Nouveau mot de passe</h1>
          </div>
        </div>
        {token ? (
          <form action={resetPasswordAction} className="grid gap-4">
            <input type="hidden" name="token" value={token} />
            <label className="grid gap-2">
              <span className="font-semibold">Mot de passe</span>
              <input
                required
                minLength={8}
                type="password"
                name="password"
                className="rounded-md border border-slate-200 px-4 py-3"
              />
            </label>
            <label className="grid gap-2">
              <span className="font-semibold">Confirmation</span>
              <input
                required
                minLength={8}
                type="password"
                name="passwordConfirm"
                className="rounded-md border border-slate-200 px-4 py-3"
              />
            </label>
            <button className="rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white">
              Mettre à jour
            </button>
          </form>
        ) : (
          <p className="leading-7 text-slate-700">
            Le lien de réinitialisation est manquant. Demandez un nouveau lien
            depuis la page de connexion.
          </p>
        )}
        <Link href="/" className="mt-5 block text-sm font-semibold text-slate-600">
          Retour à la connexion
        </Link>
      </section>
    </main>
  );
}
