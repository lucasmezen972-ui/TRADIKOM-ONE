import { DomainConnectionError } from "@/modules/domain-connections/errors";
import type {
  DnsChange,
  DnsRecord,
  DomainEvidence,
  DomainProviderKey,
} from "@/modules/domain-connections/schemas";

export type DomainProviderCapabilities = {
  readRecords: boolean;
  createRecord: boolean;
  updateRecord: boolean;
  deleteRecord: boolean;
  manageNameservers: boolean;
  validatePropagation: boolean;
  oauth: boolean;
  apiKey: boolean;
  sandbox: boolean;
};

export type DomainAnalysis = {
  providerKey: DomainProviderKey;
  providerLabel: string;
  likelyRegistrar: string | null;
  likelyHosting: string | null;
  certificateStatus: "available" | "unavailable" | "unknown";
  records: DnsRecord[];
  evidence: DomainEvidence[];
};

export type DomainProviderAdapter = {
  key: DomainProviderKey;
  label: string;
  capabilities: DomainProviderCapabilities;
  analyze: (domain: string, observedAt: string) => Promise<DomainAnalysis>;
};

const mockCapabilities: DomainProviderCapabilities = {
  readRecords: true,
  createRecord: true,
  updateRecord: true,
  deleteRecord: false,
  manageNameservers: false,
  validatePropagation: true,
  oauth: false,
  apiKey: true,
  sandbox: true,
};

const manualCapabilities: DomainProviderCapabilities = {
  readRecords: false,
  createRecord: false,
  updateRecord: false,
  deleteRecord: false,
  manageNameservers: false,
  validatePropagation: true,
  oauth: false,
  apiKey: false,
  sandbox: false,
};

export const mockDnsProvider: DomainProviderAdapter = {
  key: "mock_dns",
  label: "Fournisseur DNS de test",
  capabilities: mockCapabilities,
  async analyze(domain, observedAt) {
    const records: DnsRecord[] = [
      record("NS", "@", "ns1.mock-dns.invalid", 3600),
      record("NS", "@", "ns2.mock-dns.invalid", 3600),
      record("A", "@", "203.0.113.10", 300),
      record("AAAA", "@", "2001:db8::10", 300),
      record("CNAME", "www", domain, 300),
      record("MX", "@", "mail.mock-dns.invalid", 3600, 10),
      record("TXT", "@", "v=spf1 include:_spf.mock-dns.invalid ~all", 3600),
      record("TXT", "selector1._domainkey", "v=DKIM1; p=MOCK_PUBLIC_KEY", 3600),
      record("TXT", "_dmarc", "v=DMARC1; p=quarantine", 3600),
    ];
    const evidence = [
      evidence("provider", "Mock DNS Provider", 100, observedAt, "verified"),
      evidence("registrar", "Registraire de test", 100, observedAt, "verified"),
      evidence("hosting", "Hébergement de test", 100, observedAt, "verified"),
      ...records.map((item) =>
        evidence(
          `dns.${item.type}`,
          `${item.name}=${item.value}`,
          100,
          observedAt,
          "verified",
        ),
      ),
    ];

    return {
      providerKey: "mock_dns",
      providerLabel: "Fournisseur DNS de test",
      likelyRegistrar: "Registraire de test",
      likelyHosting: "Hébergement de test",
      certificateStatus: "unavailable",
      records,
      evidence,
    };
  },
};

export const manualSetupProvider: DomainProviderAdapter = {
  key: "manual",
  label: "Configuration manuelle",
  capabilities: manualCapabilities,
  async analyze(_domain, observedAt) {
    return {
      providerKey: "manual",
      providerLabel: "Configuration manuelle",
      likelyRegistrar: null,
      likelyHosting: null,
      certificateStatus: "unknown",
      records: [],
      evidence: [
        {
          field: "provider",
          value: "Fournisseur non vérifié",
          confidence: 0,
          source: "saisie_utilisateur",
          observedAt,
          status: "inferred",
        },
      ],
    };
  },
};

const providerAdapters = new Map<DomainProviderKey, DomainProviderAdapter>([
  [mockDnsProvider.key, mockDnsProvider],
  [manualSetupProvider.key, manualSetupProvider],
]);

export function getDomainProviderAdapter(key: DomainProviderKey) {
  const adapter = providerAdapters.get(key);
  if (!adapter) {
    throw new DomainConnectionError(
      "provider_capability_missing",
      "Ce fournisseur de domaine n'est pas pris en charge.",
    );
  }
  return adapter;
}

export function normalizeDomain(rawDomain: string) {
  const candidate = rawDomain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/, 1)[0]
    ?.replace(/\.$/, "") ?? "";
  if (
    !candidate ||
    candidate.length > 253 ||
    candidate === "localhost" ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate) ||
    !candidate.includes(".") ||
    !candidate.split(".").every((label) =>
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  ) {
    throw new DomainConnectionError(
      "dns_change_blocked",
      "Le nom de domaine n'est pas valide.",
    );
  }
  return candidate;
}

export function assertDnsChangesAreSafe(
  currentRecords: DnsRecord[],
  changes: DnsChange[],
) {
  for (const change of changes) {
    if (change.action === "delete") {
      throw blocked("Les suppressions DNS sont bloquées par défaut.");
    }
    if (change.record.type === "NS") {
      throw blocked("Le remplacement des serveurs de noms est bloqué.");
    }
    if (change.record.type === "MX") {
      throw blocked("Les modifications MX sont bloquées.");
    }

    const previous = change.previousRecord ?? findCurrentRecord(currentRecords, change.record);
    if (change.action === "update" && previous?.type === "TXT") {
      if (isSpf(previous.value)) {
        throw blocked("Le remplacement SPF est bloqué.");
      }
      if (isDmarc(previous.name, previous.value) && weakensDmarc(previous.value, change.record.value)) {
        throw blocked("Un affaiblissement DMARC est bloqué.");
      }
    }
  }
}

export function buildManualSetupGuide(changes: DnsChange[]) {
  return changes.map((change, index) => ({
    step: index + 1,
    title: `Ajouter l'enregistrement ${change.record.type}`,
    menuLabel: "Zone DNS / Enregistrements",
    name: change.record.name,
    value: change.record.value,
    ttl: change.record.ttl,
    warning:
      change.record.type === "TXT" || change.record.type === "MX"
        ? "Vérifiez les enregistrements de messagerie voisins avant toute action."
        : "Cette instruction n'altère aucun enregistrement de messagerie.",
    verification: `Vérifier ${change.record.type} ${change.record.name}`,
    rollback: `Supprimer uniquement l'enregistrement ${change.record.type} ajouté par ce plan.`,
  }));
}

function record(
  type: DnsRecord["type"],
  name: string,
  value: string,
  ttl: number,
  priority: number | null = null,
): DnsRecord {
  return { type, name, value, ttl, priority };
}

function evidence(
  field: string,
  value: string,
  confidence: number,
  observedAt: string,
  status: DomainEvidence["status"],
): DomainEvidence {
  return {
    field,
    value,
    confidence,
    source: "fixture_dns_locale",
    observedAt,
    status,
  };
}

function blocked(message: string) {
  return new DomainConnectionError("dns_change_blocked", message);
}

function findCurrentRecord(records: DnsRecord[], candidate: DnsRecord) {
  return records.find(
    (recordItem) =>
      recordItem.type === candidate.type && recordItem.name === candidate.name,
  );
}

function isSpf(value: string) {
  return value.trim().toLowerCase().startsWith("v=spf1");
}

function isDmarc(name: string, value: string) {
  return name.toLowerCase() === "_dmarc" || value.toLowerCase().startsWith("v=dmarc1");
}

function weakensDmarc(previous: string, next: string) {
  const rank = (value: string) => {
    const policy = value.toLowerCase().match(/(?:^|;)\s*p=(none|quarantine|reject)/)?.[1];
    return policy === "reject" ? 3 : policy === "quarantine" ? 2 : policy === "none" ? 1 : 0;
  };
  return rank(next) < rank(previous);
}
