import { getDb } from "@/lib/db";
import { listGithubPublicConnectors } from "@/modules/github-public/service";
import { installGithubPublicAction, refreshGithubPublicAction, revokeGithubPublicAction } from "./github-actions";
export async function GithubPublicPanel({ userId, tenantId }: { userId: string; tenantId: string }) {
  const connectors = await listGithubPublicConnectors(await getDb(), userId, tenantId);
  return <section id="github-public" aria-label="Connecteur GitHub public" className="rounded-xl border border-slate-200 bg-white p-5">
    <h2 className="text-xl font-bold">GitHub · tickets publics en lecture seule</h2>
    <p className="mt-2 text-sm text-slate-600">Connexion réelle sans jeton. Lisez jusqu’à 25 tickets ouverts d’un dépôt public, à la demande. Les demandes de fusion sont exclues. Aucun ticket ni message n’est créé sur GitHub.</p>
    <form action={installGithubPublicAction} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="text-sm">Propriétaire<input name="owner" required maxLength={39} pattern={"[A-Za-z0-9][A-Za-z0-9\\-]*"} className="mt-1 block rounded border p-2" /></label>
      <label className="text-sm">Dépôt public<input name="repository" required maxLength={100} pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]*"} className="mt-1 block rounded border p-2" /></label>
      <label className="flex max-w-md items-start gap-2 text-xs"><input name="consent" type="checkbox" required value="true" />J’autorise la lecture de ces tickets publics et leur affichage à mon organisation. Le nom du dépôt est envoyé à GitHub.</label>
      <button className="min-h-11 rounded bg-slate-950 px-4 py-2 text-sm font-bold text-white">Installer la lecture GitHub</button>
    </form>
    <p className="mt-2 text-xs text-slate-500">Installation et révocation réservées aux responsables. Une lecture par minute et par connecteur. La révocation est définitive pour cette installation et efface le dernier résultat.</p>
    <ul className="mt-5 space-y-4">{connectors.map(connector => <li key={connector.id} className="rounded border p-4">
      <h3 className="font-bold">{connector.owner_name}/{connector.repository_name}</h3>
      <p role="status" className="text-sm">{connector.status === "active" ? "Lecture seule active" : "Accès révoqué"}{connector.last_checked_at ? ` · Dernière lecture : ${new Date(connector.last_checked_at).toLocaleString("fr-FR", { timeZone: "America/Martinique" })}` : " · Jamais lu"}</p>
      {connector.status === "active" ? <div className="mt-2 flex gap-3">
        <form action={refreshGithubPublicAction}><input type="hidden" name="connectorId" value={connector.id} /><button className="min-h-11 rounded border px-3 py-2 text-sm">Lire les tickets publics</button></form>
        <form action={revokeGithubPublicAction}><input type="hidden" name="connectorId" value={connector.id} /><button className="min-h-11 rounded border border-red-200 px-3 py-2 text-sm text-red-800">Révoquer l’accès GitHub</button></form>
      </div> : null}
      {connector.issues.length ? <ul className="mt-3 space-y-1 text-sm">{connector.issues.map(issue => <li key={issue.number}><a rel="noreferrer noopener" target="_blank" href={`https://github.com/${connector.owner_name}/${connector.repository_name}/issues/${issue.number}`}>#{issue.number} · {issue.title}</a></li>)}</ul> : null}
    </li>)}</ul>
  </section>;
}
