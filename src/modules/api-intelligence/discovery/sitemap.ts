import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { DiscoveryError } from "@/modules/api-intelligence/discovery/errors";
import { validateDiscoveryUrl } from "@/modules/api-intelligence/discovery/security";

export const sitemapParserVersion = "sitemap-1";
export const sitemapMaxBytes = 512 * 1024;
export const sitemapMaxDocuments = 5;
export const sitemapMaxDepth = 2;
export const sitemapMaxCandidates = 100;

export const domainScanInputSchema = z.object({
  domainId: z.string().min(1).max(160),
});

export const discoveryCandidateDecisionSchema = z.object({
  candidateId: z.string().min(1).max(160),
  status: z.enum(["accepted", "rejected"]),
  apiProductId: z.string().min(1).max(160).optional(),
  reason: z.string().trim().min(3).max(500),
});

const parser = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  ignorePiTags: true,
  maxNestedTags: 12,
  parseTagValue: false,
  processEntities: false,
  removeNSPrefix: true,
  trimValues: true,
  isArray: (tagName) => tagName === "url" || tagName === "sitemap",
});

export function parseSitemapDocument(content: string) {
  if (
    Buffer.byteLength(content) > sitemapMaxBytes ||
    /<!DOCTYPE|<!ENTITY/i.test(content)
  ) {
    throw invalidSitemap("Sitemap XML non autorise ou trop volumineux.");
  }
  const validation = XMLValidator.validate(content, {
    allowBooleanAttributes: false,
  });
  if (validation !== true) {
    throw invalidSitemap("Sitemap XML invalide.");
  }

  let document: unknown;
  try {
    document = parser.parse(content);
  } catch {
    throw invalidSitemap("Sitemap XML invalide.");
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw invalidSitemap("Structure de sitemap invalide.");
  }
  const root = document as Record<string, unknown>;
  if (root.urlset && root.sitemapindex) {
    throw invalidSitemap("Structure de sitemap ambigue.");
  }
  if (root.urlset) {
    return {
      kind: "urlset" as const,
      locations: extractLocations(root.urlset, "url"),
    };
  }
  if (root.sitemapindex) {
    return {
      kind: "sitemapindex" as const,
      locations: extractLocations(root.sitemapindex, "sitemap"),
    };
  }
  throw invalidSitemap("Racine de sitemap non prise en charge.");
}

export function canonicalizeDiscoveredUrl(value: string, approvedDomain: string) {
  if (value.length > 2_048) {
    throw new DiscoveryError("url_not_allowed", "URL de sitemap trop longue.");
  }
  const url = validateDiscoveryUrl(value.trim(), approvedDomain);
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (
      normalized.startsWith("utm_") ||
      ["ref", "source", "campaign"].includes(normalized)
    ) {
      url.searchParams.delete(key);
      continue;
    }
    if (/(token|secret|password|signature|api[_-]?key|authorization)/i.test(key)) {
      throw new DiscoveryError(
        "url_not_allowed",
        "Parametre sensible refuse dans une URL decouverte.",
      );
    }
  }
  url.searchParams.sort();
  return url.toString();
}

export function classifyDiscoveredApiCandidate(canonicalUrl: string) {
  const url = new URL(canonicalUrl);
  const signal = `${url.pathname} ${url.search}`.toLowerCase();
  if (/\/(?:\.well-known\/)?(?:openid-configuration|oauth-authorization-server)(?:\/|$)/.test(signal)) {
    return candidate("official_oauth_metadata", 98, "Metadonnees OAuth officielles");
  }
  if (/(?:openapi|swagger).*(?:\.json|\.ya?ml)|(?:\.json|\.ya?ml).*(?:openapi|swagger)/.test(signal)) {
    return candidate("official_openapi_specification", 96, "Specification OpenAPI probable");
  }
  if (/postman|collection\.json/.test(signal)) {
    return candidate("official_postman_collection", 92, "Collection Postman probable");
  }
  if (/graphql|schema\.(?:graphql|gql|json)/.test(signal)) {
    return candidate("official_graphql_schema", 90, "Schema GraphQL probable");
  }
  if (/changelog|release-notes|deprecat/.test(signal)) {
    return candidate("official_changelog", 84, "Journal de changements probable");
  }
  if (/partner|partenaire/.test(signal)) {
    return candidate("official_partner_page", 76, "Acces partenaire probable");
  }
  if (/status|statut/.test(signal)) {
    return candidate("official_status_page", 74, "Page de statut probable");
  }
  if (/developer|developers|api|reference|docs|webhook|sandbox/.test(signal)) {
    return candidate("official_developer_documentation", 70, "Documentation API probable");
  }
  return null;
}

function extractLocations(root: unknown, entryName: "url" | "sitemap") {
  if (!root || typeof root !== "object" || Array.isArray(root)) return [];
  const rawEntries = (root as Record<string, unknown>)[entryName];
  const entries = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries === undefined
      ? []
      : [rawEntries];
  if (entries.length > 2_000) {
    throw new DiscoveryError(
      "sitemap_limit_exceeded",
      "Le sitemap contient trop d'entrees.",
    );
  }
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const location = (entry as Record<string, unknown>).loc;
    return typeof location === "string" && location.trim()
      ? [location.trim()]
      : [];
  });
}

function candidate(sourceType: string, confidence: number, reason: string) {
  return { sourceType, confidence, reason };
}

function invalidSitemap(message: string) {
  return new DiscoveryError("sitemap_invalid", message);
}
