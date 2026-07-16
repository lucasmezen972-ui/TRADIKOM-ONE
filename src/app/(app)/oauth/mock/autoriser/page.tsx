import Link from "next/link";
import { ArrowLeft, LockKeyhole, ShieldCheck } from "lucide-react";
import { rejectMockOAuthAction } from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import { authorizeMockOAuthCallbackAction } from "./actions";

export const dynamic = "force-dynamic";

type MockOAuthConsentPageProps = {
  searchParams: Promise<{
    state?: string;
    code_challenge?: string;
    redirect_uri?: string;
  }>;
};

const scopeLabels: Record<string, string> = {
  "contacts.read": "Lire les contacts",
  "profile.read": "Lire le profil du compte",
};

export default async function MockOAuthConsentPage({
  searchParams,
}: MockOAuthConsentPageProps) {
  const params = await searchParams;
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const request = {
    state: params.state ?? "",
    codeChallenge: params.code_challenge ?? "",
    redirectUri: params.redirect_uri ?? "",
  };
  const authorization = await services
    .inspectMockOAuthAuthorization(user.id, tenant.id, request)
    .catch(() => null);

  if (!authorization) {
    return (
      <div className="grid gap-6">
        <header>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Autorisation OAuth
          </p>
          <h1 className="mt-1 text-3xl font-bold">Demande invalide ou expirée</h1>
        </header>
        <section className="border-y border-red-200 bg-red-50 px-4 py-6 text-sm text-red-800">
          La connexion n’a pas été autorisée. Aucun accès logiciel n’a été créé.
        </section>
        <Link
          href="/connexions/logiciels"
          className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-950"
        >
          <ArrowLeft size={16} aria-hidden />
          Retour aux connexions logicielles
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-7">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Fournisseur OAuth de test
        </p>
        <h1 className="mt-1 text-3xl font-bold">Autoriser {authorization.softwareName}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Cette fixture locale reproduit un consentement OAuth. Elle n’utilise
          aucun réseau externe et ne peut effectuer aucune écriture.
        </p>
      </header>

      <section className="grid gap-5 border-y border-slate-200 py-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck size={22} aria-hidden />
            <h2 className="text-xl font-bold">Accès demandés</h2>
          </div>
          <ul className="mt-4 grid gap-3 text-sm text-slate-700">
            {authorization.scopes.map((scope) => (
              <li key={scope} className="flex items-center gap-2">
                <LockKeyhole size={16} aria-hidden />
                {scopeLabels[scope] ?? scope}
              </li>
            ))}
          </ul>
        </div>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="font-semibold text-slate-900">Compte</dt>
            <dd className="mt-1 text-slate-600">{authorization.accountLabel}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Environnement</dt>
            <dd className="mt-1 text-slate-600">
              {authorization.environment === "mock"
                ? "Mock local"
                : authorization.environment}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Effets externes</dt>
            <dd className="mt-1 text-slate-600">Aucun</dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap gap-3">
        <form action={authorizeMockOAuthCallbackAction}>
          <input type="hidden" name="state" value={request.state} />
          <input
            type="hidden"
            name="codeChallenge"
            value={request.codeChallenge}
          />
          <input type="hidden" name="redirectUri" value={request.redirectUri} />
          <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
            <ShieldCheck size={17} aria-hidden />
            Autoriser la connexion
          </button>
        </form>
        <form action={rejectMockOAuthAction}>
          <input
            type="hidden"
            name="connectionId"
            value={authorization.connectionId}
          />
          <button className="min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Refuser
          </button>
        </form>
      </div>
    </div>
  );
}
