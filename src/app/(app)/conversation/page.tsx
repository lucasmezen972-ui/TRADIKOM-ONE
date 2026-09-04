import { randomUUID } from "node:crypto";
import Link from "next/link";
import {
  Bot,
  CheckCircle2,
  ListChecks,
  MessageCircle,
  Paperclip,
  Radio,
  RotateCcw,
  Send,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { requireTenantContext } from "@/lib/session";
import { getConversationChannelServices } from "@/modules/channels";
import {
  createConversationPlanAction,
  decideConversationPlanAction,
  executeConversationPlanAction,
  retryConversationPlanAction,
  sendTestChannelMessageAction,
  sendWebConversationMessageAction,
} from "@/app/(app)/conversation/actions";

export const dynamic = "force-dynamic";

type ConversationPageProps = {
  searchParams: Promise<{
    fil?: string;
    envoye?: "web" | "test";
    plan?: "cree" | "approved" | "rejected" | "executed";
    reprise?: "demandee";
  }>;
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
  const plans = thread
    ? await services.listPlans(user.id, tenant.id, thread.id)
    : [];
  const currentPlan = plans[0];
  const sourceMessage = thread
    ? [...thread.messages]
        .reverse()
        .find(
          (message) =>
            message.direction === "inbound" && message.kind === "text",
        )
    : undefined;
  const identities = new Map(
    thread?.identities.map((identity) => [identity.id, identity] as const),
  );
  const canWrite = [
    "owner",
    "administrator",
    "manager",
    "collaborator",
  ].includes(membership.role);
  const canDecide = ["owner", "administrator", "manager"].includes(
    membership.role,
  );

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-slate-500">
            Conversation continue
          </p>
          <h1 className="mt-1 text-4xl font-bold">Conversation</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Un fil canonique partagé entre les canaux, avec déduplication,
            provenance, pièces jointes sécurisées et audit.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-900">
          <ShieldCheck size={17} aria-hidden />
          Canaux contrôlés et audités
        </span>
      </header>

      {params.envoye ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          Message reçu depuis{" "}
          {params.envoye === "web" ? "le web" : "le canal de test"}.
        </div>
      ) : null}

      {params.plan ? (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-950">
          {params.plan === "cree"
            ? "Plan déterministe créé et placé en attente de validation."
            : params.plan === "approved"
              ? "Plan approuvé. Il est prêt pour l’exécution mock."
              : params.plan === "executed"
                ? "Exécution mock terminée et preuve durable enregistrée."
                : "Plan refusé. Aucune action n’a été exécutée."}
        </div>
      ) : null}

      {params.reprise === "demandee" ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
          Reprise demandée une seule fois. Le worker continuera la mission sans
          rejouer une étape déjà réussie.
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
                const isOrchestrator =
                  message.provenance.adapterKey === "orchestrator-mock";
                const channelLabel = conversationChannelLabel(
                  identity?.channelKind,
                  message.provenance.adapterKey,
                );
                return (
                  <article
                    key={message.id}
                    className={`max-w-2xl rounded-xl px-4 py-3 ${
                      isWeb
                        ? "ml-auto bg-[#08111f] text-white"
                        : isOrchestrator
                          ? "border border-violet-200 bg-violet-50 text-violet-950"
                          : "bg-teal-50 text-teal-950"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold uppercase tracking-[0.1em] opacity-70">
                      <span>
                        {isOrchestrator ? "TRADIKOM ONE" : channelLabel}
                      </span>
                      <time dateTime={message.occurredAt}>
                        {formatDate(message.occurredAt)}
                      </time>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                      {message.text}
                    </p>
                    {message.attachments.length > 0 ? (
                      <ul className="mt-3 grid gap-2" aria-label="Pièces jointes">
                        {message.attachments.map((attachment) => (
                          <li
                            key={attachment.id}
                            className="flex flex-wrap items-center gap-2 rounded-lg border border-current/15 bg-white/70 px-3 py-2 text-xs normal-case tracking-normal text-slate-800"
                          >
                            <Paperclip size={15} aria-hidden />
                            <span className="font-semibold">{attachment.fileName}</span>
                            <span className="text-slate-500">
                              {formatFileSize(attachment.sizeBytes)}
                            </span>
                            <span className="rounded-full bg-amber-100 px-2 py-1 font-semibold text-amber-950">
                              {attachment.storageReference.startsWith("mock:")
                                ? "Stockage mock"
                                : "Stockage sécurisé"}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
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

          {thread ? (
            <PlanPanel
              threadId={thread.id}
              sourceMessageId={sourceMessage?.id}
              plan={currentPlan}
              canCreate={canWrite}
              canDecide={canDecide}
            />
          ) : null}

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

type ConversationServices = Awaited<
  ReturnType<typeof getConversationChannelServices>
>;
type ConversationPlan = Awaited<
  ReturnType<ConversationServices["listPlans"]>
>[number];

function PlanPanel({
  threadId,
  sourceMessageId,
  plan,
  canCreate,
  canDecide,
}: {
  threadId: string;
  sourceMessageId?: string;
  plan?: ConversationPlan;
  canCreate: boolean;
  canDecide: boolean;
}) {
  return (
    <section className="border-t border-slate-200 bg-violet-50/50 p-4 lg:p-5" aria-label="Plan d’action">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-bold text-violet-950">
            <ListChecks size={18} aria-hidden />
            Plan d’action contrôlé
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Deux capacités locales, coût externe nul, une seule validation.
          </p>
        </div>
        {sourceMessageId && canCreate ? (
          <form action={createConversationPlanAction}>
            <input type="hidden" name="threadId" value={threadId} />
            <input
              type="hidden"
              name="sourceMessageId"
              value={sourceMessageId}
            />
            <button className="min-h-11 rounded-md bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800">
              {plan ? "Rejouer la génération" : "Préparer le plan"}
            </button>
          </form>
        ) : null}
      </div>

      {plan ? (
        <div className="mt-4 rounded-lg border border-violet-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-slate-950">
                {plan.plan.businessGoal}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {plan.plan.riskSummary}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold ${planStatusClass(plan.approvalStatus)}`}>
              {planStatusLabel(plan.approvalStatus)}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-slate-500">Confiance</dt>
              <dd className="mt-1 font-bold text-slate-900">
                {Math.round(plan.plan.confidence * 100)} %
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Coût externe estimé</dt>
              <dd className="mt-1 font-bold text-slate-900">0,00 €</dd>
            </div>
            <div>
              <dt className="text-slate-500">Environnement</dt>
              <dd className="mt-1 font-bold text-slate-900">Mock local</dd>
            </div>
          </dl>
          <ol className="mt-4 grid gap-3">
            {plan.plan.steps.map((step, index) => (
              <li key={step.stepId} className="rounded-md bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-slate-950">
                    {index + 1}. {step.capability}
                  </span>
                  <span className="text-xs font-semibold text-slate-500">
                    {planStepStatusLabel(plan.steps[index]?.status)} · Risque{" "}
                    {step.risk === "low" ? "faible" : "moyen"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Preuve attendue : {step.evidenceRequired.join(" · ")}
                </p>
              </li>
            ))}
          </ol>

          {plan.approvalStatus === "awaiting_approval" ? (
            canDecide ? (
              <div className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
                <DecisionForm
                  threadId={threadId}
                  planId={plan.id}
                  decision="approved"
                />
                <DecisionForm
                  threadId={threadId}
                  planId={plan.id}
                  decision="rejected"
                />
              </div>
            ) : (
              <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-950">
                Un responsable, administrateur ou propriétaire doit valider ce plan.
              </p>
            )
          ) : null}
          {plan.approvalStatus === "approved" &&
          plan.mission?.status === "failed" &&
          canDecide ? (
            <form
              action={retryConversationPlanAction}
              className="mt-4 border-t border-slate-200 pt-4"
            >
              <input type="hidden" name="threadId" value={threadId} />
              <input type="hidden" name="planId" value={plan.id} />
              <p className="text-sm font-semibold text-rose-900">
                Mission interrompue. Les preuves déjà acquises sont conservées.
              </p>
              <button className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800">
                <RotateCcw size={16} aria-hidden />
                Reprendre la mission
              </button>
              <p className="mt-2 text-xs text-slate-500">
                Le signal est idempotent et la reprise utilise le snapshot validé.
              </p>
            </form>
          ) : null}
          {plan.approvalStatus === "approved" &&
          !plan.mission &&
          canDecide ? (
            <form
              action={executeConversationPlanAction}
              className="mt-4 border-t border-slate-200 pt-4"
            >
              <input type="hidden" name="threadId" value={threadId} />
              <input type="hidden" name="planId" value={plan.id} />
              <button className="inline-flex min-h-11 items-center gap-2 rounded-md bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800">
                <Bot size={16} aria-hidden />
                Exécuter les deux étapes en mock
              </button>
              <p className="mt-2 text-xs text-slate-500">
                L’exécution est durable et idempotente, sans appel ni effet externe.
              </p>
            </form>
          ) : null}
          {plan.approvalStatus === "approved" &&
          plan.mission &&
          plan.mission.status !== "failed" ? (
            <p className="mt-4 rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">
              Mission durable : {missionStatusLabel(plan.mission.status)}.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-dashed border-violet-300 bg-white p-4 text-sm text-slate-600">
          {sourceMessageId
            ? "Préparez un plan immuable à partir du dernier message entrant."
            : "Un message entrant est requis avant de préparer un plan."}
        </p>
      )}
    </section>
  );
}

function DecisionForm({
  threadId,
  planId,
  decision,
}: {
  threadId: string;
  planId: string;
  decision: "approved" | "rejected";
}) {
  const approved = decision === "approved";
  return (
    <form action={decideConversationPlanAction} className="rounded-md border border-slate-200 p-3">
      <input type="hidden" name="threadId" value={threadId} />
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="decision" value={decision} />
      <label className="text-xs font-bold text-slate-700" htmlFor={`reason-${decision}`}>
        Motif de {approved ? "validation" : "refus"}
      </label>
      <textarea
        id={`reason-${decision}`}
        name="reason"
        required
        minLength={3}
        maxLength={500}
        rows={2}
        placeholder={approved ? "Plan vérifié et autorisé" : "Correction attendue"}
        className="mt-2 w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm"
      />
      <button className={`mt-2 inline-flex min-h-11 items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-white ${approved ? "bg-emerald-700 hover:bg-emerald-800" : "bg-rose-700 hover:bg-rose-800"}`}>
        {approved ? <CheckCircle2 size={16} aria-hidden /> : <XCircle size={16} aria-hidden />}
        {approved ? "Approuver une fois" : "Refuser"}
      </button>
    </form>
  );
}

function planStatusLabel(status: ConversationPlan["approvalStatus"]) {
  return {
    draft: "Brouillon",
    awaiting_approval: "Validation requise",
    approved: "Approuvé",
    rejected: "Refusé",
    executed: "Exécuté",
  }[status];
}

function planStatusClass(status: ConversationPlan["approvalStatus"]) {
  if (status === "approved" || status === "executed") {
    return "bg-emerald-100 text-emerald-900";
  }
  if (status === "rejected") return "bg-rose-100 text-rose-900";
  return "bg-amber-100 text-amber-950";
}

function planStepStatusLabel(status?: ConversationPlan["steps"][number]["status"]) {
  return {
    planned: "Planifiée",
    approved: "Approuvée",
    running: "En cours",
    succeeded: "Réussie",
    failed: "Échec",
    cancelled: "Annulée",
  }[status ?? "planned"];
}

function missionStatusLabel(status: string) {
  return {
    pending: "planifiée",
    running: "en cours",
    waiting: "reprise en attente",
    approval_required: "validation requise",
    succeeded: "terminée",
    failed: "interrompue",
    rejected: "refusée",
    cancelled: "annulée",
  }[status] ?? "état contrôlé";
}

function conversationChannelLabel(
  channelKind: string | undefined,
  adapterKey: string,
) {
  if (adapterKey === "whatsapp-meta") return "WhatsApp";
  if (channelKind === "web") return "Web";
  if (channelKind === "test") return "Canal de test";
  if (channelKind === "email") return "E-mail";
  if (channelKind === "voice") return "Voix";
  if (channelKind === "collaboration") return "Collaboration";
  return "Messagerie";
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} o`;
  if (sizeBytes < 1024 * 1024) return `${Math.ceil(sizeBytes / 1024)} Ko`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1).replace(".", ",")} Mo`;
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
