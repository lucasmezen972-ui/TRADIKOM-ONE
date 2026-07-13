import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import {
  withSystemDbTransaction,
  withTenantDbTransaction,
} from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import {
  fetchUnderDiscoveryPolicy,
  discoveryParserVersion,
  type DiscoveryTransport,
} from "@/modules/api-intelligence/discovery/fetcher";
import { DiscoveryError } from "@/modules/api-intelligence/discovery/errors";
import { detectApiSnapshotChange } from "@/modules/api-intelligence/change-monitor/service";
import { assertPlatformAdmin } from "@/modules/platform-admin";
import { enforceRateLimit } from "@/modules/rate-limit";
import {
  findApiSourceById,
  findApprovedSoftwareDomain,
  findLatestApiSnapshot,
  insertApiSourceSnapshot,
} from "@/modules/software-directory";

export async function fetchApprovedApiSource(
  db: DbClient,
  userId: string,
  tenantId: string,
  sourceId: string,
  options: { transport?: DiscoveryTransport } = {},
) {
  await assertPlatformAdmin(db, userId, tenantId);
  const source = await findApiSourceById(db, sourceId);
  if (!source) {
    throw new DiscoveryError("source_not_found", "Source API introuvable.");
  }
  const approvedDomain = await findApprovedSoftwareDomain(
    db,
    source.software_id,
    source.publisher_domain,
  );
  if (!approvedDomain) {
    throw new DiscoveryError(
      "domain_not_approved",
      "Domaine source non approuve.",
    );
  }
  await enforceRateLimit(db, {
    operationKey: "api_intelligence.fetch",
    subjectKey: userId,
    scopeKey: source.publisher_domain,
    limit: 30,
    windowSeconds: 3600,
  });
  const latestSnapshot = await findLatestApiSnapshot(db, sourceId);
  const fetched = await fetchUnderDiscoveryPolicy({
    url: source.canonical_url,
    approvedDomain: source.publisher_domain,
    etag: latestSnapshot?.etag ?? undefined,
    lastModified: latestSnapshot?.last_modified ?? undefined,
    transport: options.transport,
  });
  if (fetched.notModified) {
    if (!latestSnapshot) {
      throw new DiscoveryError(
        "not_modified_without_snapshot",
        "La source n'a pas de version locale reutilisable.",
      );
    }
    return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
      await assertPlatformAdmin(transaction, userId, tenantId);
      await recordAuditLog(transaction, {
        tenantId,
        actorId: userId,
        action: "api_intelligence.source_not_modified",
        targetType: "api_source_snapshot",
        targetId: latestSnapshot.id,
        metadata: { sourceId, contentHash: latestSnapshot.content_hash },
      });
      return latestSnapshot;
    });
  }

  return withSystemDbTransaction(db, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const snapshot = await insertApiSourceSnapshot(transaction, {
      id: id("snapshot"),
      sourceId,
      retrievedAt: nowIso(),
      httpStatus: fetched.status,
      etag: fetched.etag,
      lastModified: fetched.lastModified,
      contentHash: fetched.contentHash,
      parserVersion: discoveryParserVersion,
      robotsDecision: fetched.robotsDecision,
      accessPolicyDecision: fetched.accessPolicyDecision,
      contentType: fetched.contentType,
      content: fetched.content,
      safeMetadata: fetched.safeMetadata,
      createdAt: nowIso(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.source_fetched",
      targetType: "api_source_snapshot",
      targetId: snapshot.id,
      metadata: {
        sourceId,
        contentHash: fetched.contentHash,
        publisherDomain: source.publisher_domain,
      },
    });
    if (latestSnapshot && latestSnapshot.id !== snapshot.id) {
      await detectApiSnapshotChange(transaction, userId, tenantId, {
        source,
        previousSnapshot: latestSnapshot,
        currentSnapshot: snapshot,
      });
    }
    return snapshot;
  });
}
