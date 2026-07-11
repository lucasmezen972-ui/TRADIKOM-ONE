import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

type ConfirmPageProps = {
  searchParams: Promise<{ email?: string }>;
};

export default async function ForgotPasswordConfirmPage({
  searchParams,
}: ConfirmPageProps) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-[#08111f] px-5 py-10 text-white">
      <section className="w-full max-w-md rounded-lg bg-[#fffaf1] p-6 text-slate-950 shadow-2xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-[#19c6b7] text-[#08111f]">
            <CheckCircle2 size={20} aria-hidden />
          </span>
          <div>
            <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
              Demande reçue
            </p>
            <h1 className="text-2xl font-bold">Vérifiez votre messagerie</h1>
          </div>
        </div>
        <p className="leading-7 text-slate-700">
          Si un compte existe pour {params.email || "cet email"}, un lien de
          réinitialisation sécurisé vient d&apos;être préparé.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded-md bg-[#08111f] px-5 py-3 font-semibold text-white"
        >
          Retour à la connexion
        </Link>
      </section>
    </main>
  );
}
