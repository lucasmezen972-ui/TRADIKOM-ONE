import type { DbClient } from "@/lib/db";

export type ApiDiscoveryCandidateRow = {
  id: string;
  software_id: string;
  domain_id: string;
  canonical_url: string;
  source_type: string;
  confidence: number;
  discovery_reason: string;
  sitemap_url: string;
  parser_version: string;
  status: string;
  api_source_id: string | null;
  discovered_at: string;
  last_seen_at: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
};

export async function upsertApiDiscoveryCandidate(
  db: DbClient,
  input: {
    id: string;
    softwareId: string;
    domainId: string;
    canonicalUrl: string;
    sourceType: string;
    confidence: number;
    discoveryReason: string;
    sitemapUrl: string;
    parserVersion: string;
    observedAt: string;
  },
) {
  const result = await db.query<ApiDiscoveryCandidateRow>(
    `insert into api_discovery_candidates (
       id, software_id, domain_id, canonical_url, source_type, confidence,
       discovery_reason, sitemap_url, parser_version, status, api_source_id,
       discovered_at, last_seen_at, decided_by, decided_at, decision_reason,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'under_review', null,
               $10, $10, null, null, null, $10, $10)
     on conflict (canonical_url) do update
       set source_type = excluded.source_type,
           confidence = case
             when api_discovery_candidates.confidence > excluded.confidence
               then api_discovery_candidates.confidence
             else excluded.confidence
           end,
           discovery_reason = excluded.discovery_reason,
           sitemap_url = excluded.sitemap_url,
           parser_version = excluded.parser_version,
           last_seen_at = excluded.last_seen_at,
           updated_at = excluded.updated_at
     returning *`,
    [
      input.id,
      input.softwareId,
      input.domainId,
      input.canonicalUrl,
      input.sourceType,
      input.confidence,
      input.discoveryReason,
      input.sitemapUrl,
      input.parserVersion,
      input.observedAt,
    ],
  );
  return result.rows[0]!;
}

export async function findApiDiscoveryCandidate(
  db: DbClient,
  candidateId: string,
) {
  const result = await db.query<ApiDiscoveryCandidateRow>(
    "select * from api_discovery_candidates where id = $1",
    [candidateId],
  );
  return result.rows[0] ?? null;
}

export async function setApiDiscoveryCandidateDecision(
  db: DbClient,
  input: {
    candidateId: string;
    status: "accepted" | "rejected";
    apiSourceId?: string;
    actorId: string;
    reason: string;
    decidedAt: string;
  },
) {
  await db.query(
    `update api_discovery_candidates
     set status = $1, api_source_id = $2, decided_by = $3, decided_at = $4,
         decision_reason = $5, updated_at = $4
     where id = $6`,
    [
      input.status,
      input.apiSourceId ?? null,
      input.actorId,
      input.decidedAt,
      input.reason,
      input.candidateId,
    ],
  );
}
