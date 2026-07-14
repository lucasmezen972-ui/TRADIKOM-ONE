import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { withSystemDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import { DiscoveryError } from "@/modules/api-intelligence/discovery/errors";
import {
  fetchDiscoveryRobots,
  fetchUnderDiscoveryPolicy,
  type DiscoveryTransport,
} from "@/modules/api-intelligence/discovery/fetcher";
import {
  findApiDiscoveryCandidate,
  setApiDiscoveryCandidateDecision,
  upsertApiDiscoveryCandidate,
} from "@/modules/api-intelligence/discovery/repository";
import { listSitemapsFromRobots } from "@/modules/api-intelligence/discovery/robots";
import {
  canonicalizeDiscoveredUrl,
  classifyDiscoveredApiCandidate,
  discoveryCandidateDecisionSchema,
  domainScanInputSchema,
  parseSitemapDocument,
  sitemapMaxBytes,
  sitemapMaxCandidates,
  sitemapMaxDepth,
  sitemapMaxDocuments,
  sitemapParserVersion,
} from "@/modules/api-intelligence/discovery/sitemap";
import { assertPlatformAdmin } from "@/modules/platform-admin";
import { enforceRateLimit } from "@/modules/rate-limit";
import {
  findApiProductById,
  findApiSourceByCanonicalUrl,
  findSoftwareDomainById,
  insertApiSource,
} from "@/modules/software-directory";

export async function scanApprovedSoftwareDomain(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { domainId: string },
  options: { transport?: DiscoveryTransport } = {},
) {
  const parsedInput = domainScanInputSchema.parse(input);
  await assertPlatformAdmin(db, userId, tenantId);
  const domain = await requireApprovedDomain(db, parsedInput.domainId);
  await enforceRateLimit(db, {
    operationKey: "api_intelligence.domain_scan",
    subjectKey: userId,
    scopeKey: domain.domain,
    limit: 6,
    windowSeconds: 3600,
  });

  const rootUrl = `https://${domain.domain}/`;
  const robots = await fetchDiscoveryRobots({
    url: rootUrl,
    approvedDomain: domain.domain,
    transport: options.transport,
  });
  const declaredSitemaps = listSitemapsFromRobots(robots.content);
  const initialSitemaps = declaredSitemaps.length > 0
    ? declaredSitemaps
    : [new URL("/sitemap.xml", rootUrl).toString()];
  const queue = initialSitemaps.map((url) => ({ url, depth: 0 }));
  const visited = new Set<string>();
  const candidates = new Map<
    string,
    {
      canonicalUrl: string;
      sourceType: string;
      confidence: number;
      reason: string;
      sitemapUrl: string;
    }
  >();
  let blockedUrlCount = 0;
  let truncated = false;

  while (queue.length > 0 && visited.size < sitemapMaxDocuments) {
    const next = queue.shift()!;
    let sitemapUrl: string;
    try {
      sitemapUrl = canonicalizeDiscoveredUrl(next.url, domain.domain);
    } catch {
      blockedUrlCount += 1;
      continue;
    }
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    const fetched = await fetchUnderDiscoveryPolicy({
      url: sitemapUrl,
      approvedDomain: domain.domain,
      accept: "application/xml, text/xml, text/plain;q=0.5",
      maxBytes: sitemapMaxBytes,
      transport: options.transport,
    });
    if (fetched.notModified) {
      throw new DiscoveryError(
        "sitemap_invalid",
        "Un sitemap de scan ne peut pas reutiliser un snapshot absent.",
      );
    }
    const parsed = parseSitemapDocument(fetched.content);
    if (parsed.kind === "sitemapindex") {
      if (next.depth >= sitemapMaxDepth) {
        blockedUrlCount += parsed.locations.length;
        truncated = truncated || parsed.locations.length > 0;
        continue;
      }
      for (const location of parsed.locations) {
        if (queue.length + visited.size >= sitemapMaxDocuments) {
          truncated = true;
          break;
        }
        queue.push({ url: location, depth: next.depth + 1 });
      }
      continue;
    }

    for (const location of parsed.locations) {
      if (candidates.size >= sitemapMaxCandidates) {
        truncated = true;
        break;
      }
      let canonicalUrl: string;
      try {
        canonicalUrl = canonicalizeDiscoveredUrl(location, domain.domain);
      } catch {
        blockedUrlCount += 1;
        continue;
      }
      const classification = classifyDiscoveredApiCandidate(canonicalUrl);
      if (!classification || candidates.has(canonicalUrl)) continue;
      candidates.set(canonicalUrl, {
        canonicalUrl,
        ...classification,
        sitemapUrl,
      });
    }
  }
  if (queue.length > 0) truncated = true;

  const observedAt = nowIso();
  return withSystemDbTransaction(db, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    await requireApprovedDomain(transaction, parsedInput.domainId);
    const persisted = [];
    for (const candidate of candidates.values()) {
      persisted.push(
        await upsertApiDiscoveryCandidate(transaction, {
          id: id("candidate"),
          softwareId: domain.software_id,
          domainId: domain.id,
          canonicalUrl: candidate.canonicalUrl,
          sourceType: candidate.sourceType,
          confidence: candidate.confidence,
          discoveryReason: candidate.reason,
          sitemapUrl: candidate.sitemapUrl,
          parserVersion: sitemapParserVersion,
          observedAt,
        }),
      );
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "api_intelligence.domain_scanned",
      targetType: "software_domain",
      targetId: domain.id,
      metadata: {
        domain: domain.domain,
        sitemapCount: visited.size,
        candidateCount: persisted.length,
        blockedUrlCount,
        truncated,
      },
    });
    return {
      sitemapCount: visited.size,
      candidateCount: persisted.length,
      blockedUrlCount,
      truncated,
      candidates: persisted,
    };
  });
}

export async function decideApiDiscoveryCandidate(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: {
    candidateId: string;
    status: "accepted" | "rejected";
    apiProductId?: string;
    reason: string;
  },
) {
  const parsedInput = discoveryCandidateDecisionSchema.parse(input);
  return withSystemDbTransaction(db, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const candidate = await findApiDiscoveryCandidate(
      transaction,
      parsedInput.candidateId,
    );
    if (!candidate) {
      throw new DiscoveryError(
        "candidate_not_found",
        "Candidat de source introuvable.",
      );
    }
    if (candidate.status !== "under_review") {
      throw new DiscoveryError(
        "candidate_decision_invalid",
        "Ce candidat a deja fait l'objet d'une decision.",
      );
    }
    await requireApprovedDomain(transaction, candidate.domain_id);

    let apiSourceId: string | undefined;
    if (parsedInput.status === "accepted") {
      if (!parsedInput.apiProductId) {
        throw new DiscoveryError(
          "candidate_decision_invalid",
          "Un produit API est requis pour accepter ce candidat.",
        );
      }
      const product = await findApiProductById(
        transaction,
        parsedInput.apiProductId,
      );
      if (!product || product.software_id !== candidate.software_id) {
        throw new DiscoveryError(
          "candidate_decision_invalid",
          "Produit API incompatible avec le candidat.",
        );
      }
      const existing = await findApiSourceByCanonicalUrl(
        transaction,
        candidate.canonical_url,
      );
      if (
        existing &&
        (existing.software_id !== candidate.software_id ||
          existing.api_product_id !== product.id)
      ) {
        throw new DiscoveryError(
          "candidate_decision_invalid",
          "Cette URL est deja rattachee a un autre produit API.",
        );
      }
      apiSourceId = existing?.id ?? id("source");
      if (!existing) {
        await insertApiSource(transaction, {
          id: apiSourceId,
          softwareId: candidate.software_id,
          apiProductId: product.id,
          canonicalUrl: candidate.canonical_url,
          sourceType: candidate.source_type,
          sourceClassification: "official",
          publisherDomain: new URL(candidate.canonical_url).hostname,
          createdBy: userId,
          createdAt: nowIso(),
        });
      }
    }

    const decidedAt = nowIso();
    await setApiDiscoveryCandidateDecision(transaction, {
      candidateId: candidate.id,
      status: parsedInput.status,
      apiSourceId,
      actorId: userId,
      reason: parsedInput.reason,
      decidedAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `api_intelligence.discovery_candidate_${parsedInput.status}`,
      targetType: "api_discovery_candidate",
      targetId: candidate.id,
      metadata: {
        sourceType: candidate.source_type,
        publisherDomain: new URL(candidate.canonical_url).hostname,
        apiSourceId,
      },
    });
    return {
      candidateId: candidate.id,
      status: parsedInput.status,
      apiSourceId,
    };
  });
}

async function requireApprovedDomain(db: DbClient, domainId: string) {
  const domain = await findSoftwareDomainById(db, domainId);
  if (!domain) {
    throw new DiscoveryError("domain_not_found", "Domaine logiciel introuvable.");
  }
  if (domain.approval_status !== "approved") {
    throw new DiscoveryError("domain_not_approved", "Domaine source non approuve.");
  }
  return domain;
}
