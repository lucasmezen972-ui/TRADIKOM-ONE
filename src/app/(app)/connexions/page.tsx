import { Power, RotateCcw } from "lucide-react";
import {
  importCsvAction,
  setWebhookEndpointStatusAction,
  syncMockConnectorAction,
} from "@/app/actions";
import { getServices } from "@/lib/services";
import { requireTenantContext } from "@/lib/session";
import { WebhookSecretRotationForm } from "./webhook-secret-rotation-form";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const { user, tenant } = await requireTenantContext();
  const services = await getServices();
  const connectors = await services.getConnectors(user.id, tenant.id);
  const webhook = await services.getWebhookEndpointConfig(user.id, tenant.id);

  return (
    <div className="grid gap-6">
      <header>
        <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
          Connect Store
        </p>
        <h1 className="mt-1 text-4xl font-bold">Connexions</h1>
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {connectors.map((connector) => (
          <div key={connector.key} className="rounded-lg bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-bold">{connector.name}</h2>
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold">
                {connector.status}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {connector.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {connector.capabilities.map((capability) => (
                <span
                  key={capability}
                  className="rounded-md bg-[#e6fffb] px-2 py-1 text-xs font-semibold text-[#075e57]"
                >
                  {capability}
                </span>
              ))}
            </div>
            {connector.key === "mock_business" ? (
              <form action={syncMockConnectorAction} className="mt-4">
                <button className="rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white">
                  Synchroniser
                </button>
              </form>
            ) : null}
          </div>
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Webhook generique</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Envoyez un JSON avec name, email, phone et message pour creer un
            contact, un lead, une activite et une relance.
          </p>
          <code className="mt-4 block overflow-x-auto rounded-md bg-slate-950 px-4 py-3 text-sm text-white">
            {webhook.url}
          </code>
          <div className="mt-4 grid gap-2 text-sm text-slate-600">
            <p>
              Statut:{" "}
              <span className="font-semibold text-slate-900">
                {webhook.status === "active" ? "actif" : "desactive"}
              </span>
            </p>
            <p>
              Signature:{" "}
              <span className="font-semibold text-slate-900">
                {webhook.hasSecret ? "HMAC configure" : "secret indisponible"}
              </span>
            </p>
            <p>
              Headers: x-tradikom-timestamp, x-tradikom-signature,
              x-tradikom-idempotency-key
            </p>
          </div>
          <WebhookSecretRotationForm endpointId={webhook.id} />
          <form action={setWebhookEndpointStatusAction} className="mt-3">
            <input name="endpointId" type="hidden" value={webhook.id} />
            <input
              name="status"
              type="hidden"
              value={webhook.status === "active" ? "disabled" : "active"}
            />
            <button className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
              {webhook.status === "active" ? (
                <Power size={16} aria-hidden />
              ) : (
                <RotateCcw size={16} aria-hidden />
              )}
              {webhook.status === "active" ? "Desactiver" : "Reactiver"}
            </button>
          </form>
          <div className="mt-5">
            <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-slate-500">
              Livraisons recentes
            </h3>
            <div className="mt-3 divide-y divide-slate-100 rounded-md border border-slate-200">
              {webhook.recentDeliveries.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-500">
                  Aucune livraison
                </p>
              ) : (
                webhook.recentDeliveries.map((delivery) => (
                  <div key={delivery.id} className="grid gap-1 px-3 py-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {delivery.status === "accepted" ? "acceptee" : "rejetee"}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(delivery.createdAt).toLocaleString("fr-FR")}
                      </span>
                    </div>
                    <p className="break-all text-xs text-slate-500">
                      Idempotence: {delivery.idempotencyKey ?? "-"}
                    </p>
                    {delivery.error ? (
                      <p className="text-xs font-semibold text-red-700">
                        {delivery.error}
                      </p>
                    ) : null}
                    {delivery.payloadKeys.length > 0 ? (
                      <p className="text-xs text-slate-500">
                        Champs: {delivery.payloadKeys.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Import CSV contacts</h2>
          <form action={importCsvAction} className="mt-4 grid gap-3">
            <textarea
              name="csvText"
              rows={8}
              defaultValue={"nom,email,telephone\nAlicia Nilor,alicia@example.com,+596 696 44 55 66\nDavid Jean,david@example.com,+596 696 77 88 99"}
              className="rounded-md border border-slate-200 px-4 py-3 font-mono text-sm"
            />
            <button className="rounded-md bg-[#08111f] px-4 py-3 font-semibold text-white">
              Importer les contacts
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
