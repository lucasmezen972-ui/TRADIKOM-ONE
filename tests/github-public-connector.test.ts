import { afterEach, expect, it, vi } from "vitest";
import { createMemoryDb, migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { installGithubPublicConnector, listGithubPublicConnectors, refreshGithubPublicIssues, revokeGithubPublicConnector } from "../src/modules/github-public/service";
const opened: Awaited<ReturnType<typeof createMemoryDb>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map(db => db.close())); });
const response = () => Response.json([{ number: 1, title: "Ticket public", state: "open" }, { number: 2, title: "Pull request", state: "open", pull_request: {} }]);
it("installe avec consentement, lit via l’origine fixe, exclut les PR puis révoque sans nouvel appel", async () => {
  const f = await fixture(); const transport = vi.fn(async () => response());
  const id = await installGithubPublicConnector(f.db, f.user.id, f.tenant.id, { owner: "Octocat", repository: "Hello-World", consentConfirmed: true });
  expect(await installGithubPublicConnector(f.db, f.user.id, f.tenant.id, { owner: "octocat", repository: "hello-world", consentConfirmed: true })).toBe(id);
  expect(await refreshGithubPublicIssues(f.db, f.user.id, f.tenant.id, id, transport)).toEqual([{ number: 1, title: "Ticket public", state: "open" }]);
  expect(transport).toHaveBeenCalledWith("https://api.github.com/repos/octocat/hello-world/issues?state=open&per_page=25", expect.objectContaining({ method: "GET", redirect: "error", headers: expect.not.objectContaining({ Authorization: expect.anything() }) }));
  await expect(refreshGithubPublicIssues(f.db, f.user.id, f.tenant.id, id, transport)).rejects.toThrow();
  await revokeGithubPublicConnector(f.db, f.user.id, f.tenant.id, id);
  await expect(refreshGithubPublicIssues(f.db, f.user.id, f.tenant.id, id, transport)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
  expect((await listGithubPublicConnectors(f.db, f.user.id, f.tenant.id))[0]).toMatchObject({ status: "revoked", issues: [] });
});
it("refuse injection d’URL, absence de consentement et accès hors organisation avant tout réseau", async () => {
  const f = await fixture(); const transport = vi.fn(async () => response());
  await expect(installGithubPublicConnector(f.db, f.user.id, f.tenant.id, { owner: "https://evil.test", repository: "repo", consentConfirmed: true })).rejects.toThrow();
  await expect(installGithubPublicConnector(f.db, f.user.id, f.tenant.id, { owner: "owner", repository: "repo", consentConfirmed: false as true })).rejects.toThrow();
  const id = await installGithubPublicConnector(f.db, f.user.id, f.tenant.id, { owner: "owner", repository: "repo", consentConfirmed: true });
  const other = await f.services.createTenant(f.user.id, { name: "Autre entreprise", category: "Services" });
  await expect(refreshGithubPublicIssues(f.db, f.user.id, other.id, id, transport)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  await migrate(f.db, { enableRls: true });
  await f.db.exec("create role github_connector_rls_client; grant usage on schema public to github_connector_rls_client; grant select, insert, update, delete on all tables in schema public to github_connector_rls_client; set role github_connector_rls_client");
  await f.db.query("select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false)", [other.id, f.user.id]);
  expect((await f.db.query("select * from github_public_connectors")).rows).toHaveLength(0);
  await f.db.exec("reset role");
});
it("ne publie aucun résultat si la révocation survient pendant la lecture distante", async () => {
  const f = await fixture();
  const id = await installGithubPublicConnector(f.db, f.user.id, f.tenant.id, { owner: "owner", repository: "repo", consentConfirmed: true });
  const transport = vi.fn(async () => { await revokeGithubPublicConnector(f.db, f.user.id, f.tenant.id, id); return response(); });
  await expect(refreshGithubPublicIssues(f.db, f.user.id, f.tenant.id, id, transport)).rejects.toThrow();
  expect((await listGithubPublicConnectors(f.db, f.user.id, f.tenant.id))[0].issues).toEqual([]);
});
it("refuse une réponse distante invalide ou trop volumineuse", async () => {
  const f = await fixture();
  for (const [repository, responseFactory] of [["invalid", () => Response.json({ error: "invalid" })], ["huge", () => Response.json(["x".repeat(270000)])], ["rate", () => Response.json({ message: "rate limit" }, { status: 429 })]] as const) {
    const id = await installGithubPublicConnector(f.db, f.user.id, f.tenant.id, { owner: "owner", repository, consentConfirmed: true });
    await expect(refreshGithubPublicIssues(f.db, f.user.id, f.tenant.id, id, async () => responseFactory())).rejects.toThrow();
    expect((await listGithubPublicConnectors(f.db, f.user.id, f.tenant.id)).find(row => row.id === id)?.last_checked_at).toBeNull();
  }
});
async function fixture() {
  const db = await createMemoryDb(); opened.push(db); const services = createServices(db);
  const user = await services.registerUser({ name: "Connecteur", email: "github-public@example.test", password: "FixturePassword!1" });
  const tenant = await services.createTenant(user.id, { name: "Entreprise GitHub", category: "Services" }); return { db, services, user, tenant };
}
