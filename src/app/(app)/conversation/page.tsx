import { randomUUID } from "node:crypto";
import Link from "next/link";
import { Bot, MessageCircle, Radio, Send, ShieldCheck } from "lucide-react";
import { requireTenantContext } from "@/lib/session";
import { getConversationChannelServices } from "@/modules/channels";
import {
  sendTestChannelMessageAction,
  sendWebConversationMessageAction,
} from "@/app/(app)/conversation/actions";

export const dynamic = "force-dynamic";

type ConversationPageProps = {
  searchParams: Promise<{ fil?: string; envoye?: "web" | "test" }>;
};

export default async function ConversationPage({
  searchParams,
}: ConversationPageProps) {
  const params = await searchParams;
  const { user, tenant, membership } = await requireTenantContext();
  const services = await getConversationChannelServices();
  const threads = await services.listThreads(user.id, tenant.id);
  const requestedThread = threads.find((thread) => thread.id === params.fil);
  const selectedThread = requestedThread ?? threads[0];
  const thread = selectedThread
    ? await services.getThread(user.id, tenant.id, selectedThread.id)
    : null;
  const identities = new Map(
    thread?.identities.map((identity) => [identity.id, identity] as const),
  );
  const canWrite = [
    "owner",
    "administrator",
    "manager",
    "collaborator",
  ].includes(membership.role);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Conversation continue
          </p>
          <h1 className="mt-1 text-4xl font-bold">Conversation</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Un fil canonique partagé entre le web et le canal de test, avec
            déduplication, provenance et audit.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-900">
          <ShieldCheck size={17} aria-hidden />
          Aucun fournisseur externe
        </span>
      </header>

      {params.envoye ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          Message reçu depuis{" "}
          {params.envoye === "web" ? "le web" : "le canal de test"}.
        </div>
      ) : null}

      <div className="grid min-h-[640px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm lg:grid-cols-[250px_1fr]">
        <aside className="border-b border-slate-200 bg-slate-50 p-4 lg:border-r lg:border-b-0">
          <div className="flex items-center gap-2 font-bold text-slate-900">
            <MessageCircle size={18} aria-hidden />
            Fils récents
          </div>
          <nav className="mt-4 grid gap-2" aria-label="Fils de conversation">
            {threads.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 p-3 text-sm text-slate-500">
                Votre premier message créera le fil.
              </p>
            ) : (
              threads.map((item, index) => (
                <Link
                  key={item.id}
                  href={`/conversation?fil=${encodeURIComponent(item.id)}`}
                  className={`rounded-md px-3 py-3 text-sm ${
                    item.id === selectedThread?.id
                      ? "bg-[#08111f] text-white"
                      : "bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span className="block font-semibold">Fil {index + 1}</span>
                  <span className="mt-1 block text-xs opacity-70">
                    {formatDate(item.lastMessageAt ?? item.createdAt)}
                  </span>
                </Link>
              ))
            )}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-col" aria-label="Fil canonique">
          <div className="flex-1 space-y-4 overflow-y-auto p-5 lg:p-7">
            {thread ? (
              thread.messages.map((message) => {
                const identity = identities.get(
                  message.provenance.channelIdentityId,
                );
                const isWeb = identity?.channelKind === "web";
                return (
                  <article
                    key={message.id}
                    className={`max-w-2xl rounded-xl px-4 py-3 ${
                      isWeb
                        ? "ml-auto bg-[#08111f] text-white"
                        : "bg-teal-50 text-teal-950"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.1em] opacity-70">
                      <span>{isWeb ? "Web" : "Canal de test"}</span>
                      <time dateTime={message.occurredAt}>
                        {formatDate(message.occurredAt)}
                      </time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                      {message.text}
                    </p>
                  </article>
                );
              })
            ) : (
              <div className="grid h-full min-h-72 place-items-center text-center">
                <div>
                  <Bot className="mx-auto text-slate-400" size={32} aria-hidden />
                  <h2 className="mt-3 text-xl font-bold">Commencez ici</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Écrivez une demande : elle deviendra le premier message
                    canonique.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 bg-slate-50 p-4 lg:p-5">
            {canWrite ? (
              <div className="grid gap-3 xl:grid-cols-2">
                <MessageForm
                  title="Écrire depuis le web"
                  description="Votre canal authentifié"
                  action={sendWebConversationMessageAction}
                  threadId={thread?.id}
                  channel="web"
                />
                {thread ? (
                  <MessageForm
                    title="Simuler le canal de test"
                    description="Projection locale, sans réseau"
                    action={sendTestChannelMessageAction}
                    threadId={thread.id}
                    channel="test"
                  />
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                    Le canal de test sera disponible dès que le fil web existe.
                  </div>
                )}
              </div>
            ) : (
              <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-950">
                Votre rôle permet de lire ce fil, mais pas d&apos;envoyer de message.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function MessageForm({
  title,
  description,
  action,
  threadId,
  channel,
}: {
  title: string;
  description: string;
  action: (formData: FormData) => Promise<void>;
  threadId?: string;
  channel: "web" | "test";
}) {
  const requestId = randomUUID().replaceAll("-", "");
  const occurredAt = new Date().toISOString();
  return (
    <form action={action} className="rounded-lg border border-slate-200 bg-white p-4">
      <input type="hidden" name="threadId" value={threadId ?? ""} />
      <input
        type="hidden"
        name="externalMessageId"
        value={`${channel}_message_${requestId}`}
      />
      <input
        type="hidden"
        name="idempotencyKey"
        value={`ingress:${channel}:${requestId}`}
      />
      <input
        type="hidden"
        name="correlationId"
        value={`correlation_${requestId}`}
      />
      <input type="hidden" name="occurredAt" value={occurredAt} />
      <label className="block text-sm font-bold" htmlFor={`message-${channel}`}>
        {title}
      </label>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
      <textarea
        id={`message-${channel}`}
        name="message"
        required
        maxLength={16_000}
        rows={3}
        placeholder={
          channel === "web"
            ? "Que voulez-vous accomplir ?"
            : "Réponse simulée depuis un autre canal"
        }
        className="mt-3 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
      />
      <button className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-[#08111f] px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
        {channel === "web" ? (
          <Send size={16} aria-hidden />
        ) : (
          <Radio size={16} aria-hidden />
        )}
        Envoyer
      </button>
    </form>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Martinique",
  }).format(new Date(value));
}
