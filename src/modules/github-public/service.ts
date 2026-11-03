import type { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { withTenantSystemDbTransaction } from "@/db/tenant-context";
import { hashToken, nowIso } from "@/lib/security";
import { assertTenantAccess, lockMembershipRole } from "@/modules/tenants";
import { recordAuditLog } from "@/modules/audit";
import { prepareExternalUntrustedDataView } from "@/modules/conversation-hub/external-untrusted-data";
const managers = ["owner", "administrator", "manager"] as const;
export const githubPublicManifest = { key: "github-public-issues-v1", origin: "https://api.github.com",
  permissions: ["public_repository_issues.read"], externalWrites: false, requiresCredentials: false, maximumIssues: 25 } as const;
const inputSchema = z.object({ owner: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/).transform(s => s.toLowerCase()),
  repository: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/).transform(s => s.toLowerCase()), consentConfirmed: z.literal(true) }).strict();
const issueSchema = z.object({ number: z.number().int().positive(), title: z.string().max(512), state: z.enum(["open", "closed"]), pull_request: z.unknown().optional() });
const snapshotSchema = z.array(issueSchema.omit({ pull_request: true })).max(25);
type Row = { id: string; tenant_id: string; owner_name: string; repository_name: string; status: "active" | "revoked"; version: number;
  last_requested_at: string | null; last_checked_at: string | null; latest_issues: string };
export class GithubPublicConnectorError extends Error {
  readonly code = "github_public_connector_unavailable";
  constructor() { super("Connecteur GitHub indisponible. Vérifiez l’autorisation, le dépôt public et le quota ; attendez une minute avant de réessayer."); this.name = "GithubPublicConnectorError"; }
}
export async function listGithubPublicConnectors(db: DbClient, actorId: string, tenantId: string) {
  return transaction(db, actorId, tenantId, async tx => {
    await authorize(tx, actorId, tenantId, false);
    const rows = await tx.query<Row>("select * from github_public_connectors where tenant_id = $1 order by installed_at desc limit 20", [tenantId]);
    return rows.rows.map(row => ({ ...row, issues: snapshotSchema.parse(JSON.parse(row.latest_issues)) }));
  });
}
export async function installGithubPublicConnector(db: DbClient, actorId: string, tenantId: string, input: z.input<typeof inputSchema>) {
  const parsed = inputSchema.parse(input);
  const id = `github_public_${hashToken(JSON.stringify([tenantId, parsed.owner, parsed.repository]))}`;
  return transaction(db, actorId, tenantId, async tx => {
    await authorize(tx, actorId, tenantId, true);
    // Membership lock serializes installations for one manager; advisory lock caps concurrent managers too.
    if ((tx as { __runtime?: string }).__runtime === "postgres") await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`github-public:${tenantId}`]);
    const existing = (await tx.query<Row>("select * from github_public_connectors where id = $1", [id])).rows[0];
    if (existing) { if (existing.status !== "active") throw new GithubPublicConnectorError(); return id; }
    if (Number((await tx.query<{ count: string }>("select count(*) as count from github_public_connectors where tenant_id = $1", [tenantId])).rows[0].count) >= 20) throw new GithubPublicConnectorError();
    await tx.query(`insert into github_public_connectors (id, tenant_id, owner_name, repository_name, status, installed_by, installed_at)
      values ($1, $2, $3, $4, 'active', $5, $6)`, [id, tenantId, parsed.owner, parsed.repository, actorId, nowIso()]);
    await recordAuditLog(tx, { tenantId, actorId, action: "connector.github_public.installed", targetType: "github_public_connector", targetId: id,
      metadata: { manifest: githubPublicManifest.key, permissions: [...githubPublicManifest.permissions], consentConfirmed: true, mode: "live_read_only" } });
    return id;
  });
}
export async function revokeGithubPublicConnector(db: DbClient, actorId: string, tenantId: string, id: string) {
  return transaction(db, actorId, tenantId, async tx => {
    await authorize(tx, actorId, tenantId, true);
    const row = await requireRow(tx, tenantId, id);
    if (row.status === "revoked") return;
    await tx.query("update github_public_connectors set status = 'revoked', revoked_at = $3, version = version + 1, latest_issues = '[]' where id = $1 and tenant_id = $2", [id, tenantId, nowIso()]);
    await recordAuditLog(tx, { tenantId, actorId, action: "connector.github_public.revoked", targetType: "github_public_connector", targetId: id, metadata: { mode: "live_read_only" } });
  });
}
export async function refreshGithubPublicIssues(db: DbClient, actorId: string, tenantId: string, id: string,
  transport: typeof fetch = fetch) {
  const reservation = await transaction(db, actorId, tenantId, async tx => {
    await authorize(tx, actorId, tenantId, true); const row = await requireRow(tx, tenantId, id);
    if (row.status !== "active" || (row.last_requested_at && Date.now() - Date.parse(row.last_requested_at) < 60_000)) throw new GithubPublicConnectorError();
    await tx.query("update github_public_connectors set last_requested_at = now() where tenant_id = $1 and id = $2", [tenantId, id]);
    return row;
  });
  let issues: z.infer<typeof snapshotSchema>;
  try {
    // Only the validated repository name leaves the server. No ambient token, user data or redirects.
    const response = await transport(`https://api.github.com/repos/${reservation.owner_name}/${reservation.repository_name}/issues?state=open&per_page=25`, {
      method: "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10", "User-Agent": "TRADIKOM-ONE-public-issues" },
    });
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json") || !response.body) { await response.body?.cancel(); throw new GithubPublicConnectorError(); }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length;
        if (length > 256 * 1024) throw new GithubPublicConnectorError(); chunks.push(chunk.value); }
    } finally { await reader.cancel(); }
    const parsed = z.array(issueSchema).max(25).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    issues = parsed.filter(issue => issue.pull_request === undefined).map(issue => ({ number: issue.number, state: issue.state,
      title: prepareExternalUntrustedDataView({ trustBoundary: "external_untrusted_data", mode: "native", extractorKey: "github-public-issues-v1",
        integrity: "verified", text: issue.title, extractedAt: nowIso() }).content.slice(0, 512) }));
  } catch { throw new GithubPublicConnectorError(); }
  return transaction(db, actorId, tenantId, async tx => {
    await authorize(tx, actorId, tenantId, true); const row = await requireRow(tx, tenantId, id);
    if (row.status !== "active" || row.version !== reservation.version) throw new GithubPublicConnectorError();
    await tx.query("update github_public_connectors set latest_issues = $3, last_checked_at = $4 where tenant_id = $1 and id = $2", [tenantId, id, JSON.stringify(issues), nowIso()]);
    await recordAuditLog(tx, { tenantId, actorId, action: "connector.github_public.read_completed", targetType: "github_public_connector", targetId: id,
      metadata: { mode: "live_read_only", issueCount: issues.length, externalWrites: false } });
    return issues;
  });
}
async function requireRow(db: DbClient, tenantId: string, id: string) {
  if (!/^github_public_[a-f0-9]{64}$/.test(id)) throw new GithubPublicConnectorError();
  const row = (await db.query<Row>("select * from github_public_connectors where tenant_id = $1 and id = $2 for update", [tenantId, id])).rows[0];
  if (!row) throw new GithubPublicConnectorError(); return row;
}
async function authorize(db: DbClient, actorId: string, tenantId: string, manage: boolean) {
  await assertTenantAccess(db, actorId, tenantId, manage ? [...managers] : undefined);
  const role = await lockMembershipRole(db, actorId, tenantId);
  if (!role || (manage && !managers.some(r => r === role)) || !(await db.query("select id from users where id = $1 and deleted_at is null for share", [actorId])).rows[0]) throw new GithubPublicConnectorError();
}
async function transaction<T>(db: DbClient, actorId: string, tenantId: string, callback: (tx: DbClient) => Promise<T>): Promise<T> {
  const client = db as DbClient & { __transaction?: boolean; transaction?: PGlite["transaction"] };
  if (!client.__transaction && client.transaction) return client.transaction(tx => callback({ __transaction: true, query: (sql: string, params?: unknown[]) => tx.query(sql, params) } as DbClient));
  return withTenantSystemDbTransaction(db, tenantId, actorId, callback);
}
