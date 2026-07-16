import type { DbClient } from "@/lib/db";
import { getConnectorExecutionWorkspace } from "@/modules/connector-execution";
import { getPendingApprovalOverview } from "@/modules/dashboard";
import { getDomainConnectionWorkspace } from "@/modules/domain-connections";
import { getSoftwareConnectionWorkspace } from "@/modules/software-connections";
import { getWebsiteWorkspace } from "@/modules/websites";
import { getWorkflowQueueOverview } from "@/modules/workflows";

export type ConnectionMapNode = {
  id: string;
  kind:
    | "platform"
    | "domain"
    | "website"
    | "email"
    | "software"
    | "connector"
    | "workflow"
    | "approval";
  label: string;
  detail: string;
  status:
    | "healthy"
    | "active"
    | "pending"
    | "degraded"
    | "disconnected"
    | "unknown";
  environment: "internal" | "mock" | "sandbox" | "production" | "manual";
  actionHref: string;
};

export type ConnectionMapEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  direction: "inbound" | "outbound" | "internal";
  status: ConnectionMapNode["status"];
};

export type ConnectionValueSummary = {
  id: string;
  title: string;
  setupEffort: "faible" | "moyen" | "élevé";
  likelyManualTasksReduced: string[];
  possibleAutomations: string[];
  riskReduction: string[];
  expectedTimeSaving: null;
  confidence: "fixture_locale" | "preuve_sandbox" | "preuve_production";
  unavailableInputs: string[];
};

export async function getConnectionMap(
  db: DbClient,
  userId: string,
  tenantId: string,
  options: { emailProviderName?: string } = {},
) {
  // A DbClient may represent a single embedded connection. Keep these bounded
  // reads ordered so the composition layer works identically with PGlite and
  // pooled PostgreSQL clients.
  const domains = await getDomainConnectionWorkspace(db, userId, tenantId);
  const software = await getSoftwareConnectionWorkspace(db, userId, tenantId);
  const connectors = await getConnectorExecutionWorkspace(
    db,
    userId,
    tenantId,
  );
  const website = await getWebsiteWorkspace(db, userId, tenantId);
  const workflows = await getWorkflowQueueOverview(db, userId, tenantId);
  const approvals = await getPendingApprovalOverview(db, userId, tenantId);
  const visibleSoftware = software.connections.slice(0, 8);
  const visibleSoftwareIds = new Set(visibleSoftware.map((item) => item.id));
  const visibleInstallations = connectors.installations
    .filter((item) => visibleSoftwareIds.has(item.connectionId))
    .slice(0, 10);
  const nodes: ConnectionMapNode[] = [
    {
      id: "platform",
      kind: "platform",
      label: "TRADIKOM ONE",
      detail: "Plateforme opérationnelle de l'organisation.",
      status: "healthy",
      environment: "internal",
      actionHref: "/aujourdhui",
    },
  ];
  const edges: ConnectionMapEdge[] = [];
  const websiteNode: ConnectionMapNode = {
    id: "website",
    kind: "website",
    label: website.website?.name ?? "Site web",
    detail: website.website?.currentPublishedVersionId
      ? "Une version publique immuable est disponible."
      : "Aucune version publique n'est disponible.",
    status: website.website?.currentPublishedVersionId
      ? "healthy"
      : website.website
        ? "pending"
        : "unknown",
    environment: "internal",
    actionHref: "/mon-site",
  };
  nodes.push(websiteNode);
  edges.push({
    id: "platform-website",
    from: "platform",
    to: "website",
    label: "Publication contrôlée",
    direction: "outbound",
    status: websiteNode.status,
  });

  const emailProviderName = safeEmailProviderName(options.emailProviderName);
  const emailProviderAvailable = emailProviderName !== "unavailable";
  nodes.push({
    id: "email-provider",
    kind: "email",
    label: `E-mail applicatif · ${emailProviderName}`,
    detail: emailProviderAvailable
      ? "Fournisseur applicatif configuré. Cet état ne prouve pas une livraison externe."
      : "Aucun fournisseur de livraison applicative n'est configuré.",
    status: emailProviderAvailable ? "active" : "degraded",
    environment: ["console", "test"].includes(emailProviderName)
      ? "mock"
      : "internal",
    actionHref: "/parametres",
  });
  edges.push({
    id: "platform-email-provider",
    from: "platform",
    to: "email-provider",
    label: "Notifications applicatives",
    direction: "outbound",
    status: emailProviderAvailable ? "active" : "degraded",
  });

  for (const connection of domains.connections.slice(0, 8)) {
    const binding = domains.bindings.find(
      (item) => item.connectionId === connection.id,
    );
    const status = domainStatus(connection.state, binding?.status);
    const nodeId = `domain:${connection.id}`;
    nodes.push({
      id: nodeId,
      kind: "domain",
      label: connection.domain,
      detail: binding?.status === "bound"
        ? "Domaine lié au dernier site publié, sans publication du brouillon."
        : "Domaine analysé sans routage de production actif.",
      status,
      environment: connection.providerKey === "mock_dns" ? "mock" : "manual",
      actionHref: "/connexions/domaines",
    });
    edges.push({
      id: `${nodeId}-website`,
      from: nodeId,
      to: "website",
      label:
        binding?.status === "bound" ? "Liaison vérifiée" : "Liaison non active",
      direction: "inbound",
      status,
    });
  }

  for (const connection of visibleSoftware) {
    const nodeId = `software:${connection.id}`;
    const status = softwareStatus(connection.status);
    nodes.push({
      id: nodeId,
      kind: "software",
      label: `${connection.softwareName} · ${connection.accountLabel}`,
      detail: `${connection.accountLabel} · ${connection.scopes.length} autorisation(s) minimale(s).`,
      status,
      environment: connection.environment,
      actionHref: "/connexions/logiciels",
    });
    if (
      !visibleInstallations.some(
        (item) => item.connectionId === connection.id,
      )
    ) {
      edges.push({
        id: `${nodeId}-platform`,
        from: nodeId,
        to: "platform",
        label:
          connection.status === "connected"
            ? "OAuth connecté"
            : "Accès inactif",
        direction: "inbound",
        status,
      });
    }
  }

  for (const installation of visibleInstallations) {
    const softwareId = `software:${installation.connectionId}`;
    const nodeId = `connector:${installation.id}`;
    const status = connectorStatus(
      installation.status,
      installation.health?.state,
    );
    nodes.push({
      id: nodeId,
      kind: "connector",
      label: installation.connectorKey,
      detail: `${installation.approvedOperations.length} opération(s) approuvée(s) · version ${installation.connectorVersion}.`,
      status,
      environment: installation.environment,
      actionHref: "/connexions/logiciels",
    });
    edges.push(
      {
        id: `${softwareId}-${nodeId}`,
        from: softwareId,
        to: nodeId,
        label: "Lecture autorisée",
        direction: "inbound",
        status,
      },
      {
        id: `${nodeId}-platform`,
        from: nodeId,
        to: "platform",
        label: "Synchronisation contrôlée",
        direction: "inbound",
        status,
      },
    );
  }

  const failedEvents =
    workflows.summary.find((item) => item.status === "failed")?.count ?? 0;
  const activeEvents = workflows.summary
    .filter((item) => item.status === "pending" || item.status === "processing")
    .reduce((total, item) => total + item.count, 0);
  const workflowStatus: ConnectionMapNode["status"] = failedEvents > 0
    ? "degraded"
    : activeEvents > 0
      ? "active"
      : "healthy";
  nodes.push({
    id: "workflows",
    kind: "workflow",
    label: "Automatisations internes",
    detail: failedEvents > 0
      ? `${failedEvents} événement(s) en échec terminal.`
      : activeEvents > 0
        ? `${activeEvents} événement(s) en traitement ou en attente.`
        : "Aucun traitement en retard.",
    status: workflowStatus,
    environment: "internal",
    actionHref: "/automatisations",
  });
  edges.push({
    id: "platform-workflows",
    from: "platform",
    to: "workflows",
    label: "Événements internes",
    direction: "internal",
    status: workflowStatus,
  });

  const approvalStatus: ConnectionMapNode["status"] = !approvals.canApprove
    ? "unknown"
    : approvals.visibleCount > 0
      ? "pending"
      : "healthy";
  nodes.push({
    id: "approvals",
    kind: "approval",
    label: "Approbations",
    detail: !approvals.canApprove
      ? "Aucune décision n'est exposée avec ce niveau d'autorisation."
      : approvals.visibleCount > 0
        ? `${approvals.visibleCount} décision(s) en attente dans cette vue bornée.`
        : "Aucune décision en attente.",
    status: approvalStatus,
    environment: "internal",
    actionHref: "/aujourdhui",
  });
  edges.push({
    id: "approvals-platform",
    from: "approvals",
    to: "platform",
    label: "Décisions humaines",
    direction: "internal",
    status: approvalStatus,
  });

  return {
    nodes,
    edges,
    valueSummaries: buildValueSummaries(visibleSoftware, visibleInstallations),
    limits: {
      nodeLimit: 31,
      financialGainAvailable: false,
      timeSavingMeasured: false,
    },
  };
}

function domainStatus(connectionState: string, bindingStatus?: string) {
  if (bindingStatus === "bound") return "healthy" as const;
  if (bindingStatus === "failed" || connectionState === "failed") {
    return "degraded" as const;
  }
  if (bindingStatus === "disconnected" || connectionState === "disconnected") {
    return "disconnected" as const;
  }
  return "pending" as const;
}

function softwareStatus(status: string): ConnectionMapNode["status"] {
  if (status === "connected") return "active";
  if (status === "unhealthy" || status === "authentication_expired") {
    return "degraded";
  }
  if (status === "disconnected" || status === "revoked") {
    return "disconnected";
  }
  return "pending";
}

function connectorStatus(
  status: string,
  health?: string,
): ConnectionMapNode["status"] {
  if (status === "disconnected" || status === "revoked") return "disconnected";
  if (health && health !== "healthy" && health !== "unknown") return "degraded";
  if (status === "read_only_enabled") {
    return health === "healthy" ? "healthy" : "active";
  }
  return "pending";
}

function safeEmailProviderName(name?: string) {
  const normalized = name?.trim().toLowerCase();
  if (
    normalized === "console" ||
    normalized === "test" ||
    normalized === "unavailable"
  ) {
    return normalized;
  }
  return normalized ? "configuré" : "unavailable";
}

function buildValueSummaries(
  connections: Awaited<
    ReturnType<typeof getSoftwareConnectionWorkspace>
  >["connections"],
  installations: Awaited<
    ReturnType<typeof getConnectorExecutionWorkspace>
  >["installations"],
) {
  return connections.slice(0, 10).map((connection) => {
    const installation = installations.find(
      (item) => item.connectionId === connection.id,
    );
    return {
      id: connection.id,
      title: connection.softwareName,
      setupEffort: connection.status === "connected" ? "faible" : "moyen",
      likelyManualTasksReduced: installation?.status === "read_only_enabled"
        ? ["Consultation manuelle répétée des données autorisées"]
        : [],
      possibleAutomations: installation?.approvedOperations.map(
        (operation) => `Lecture contrôlée : ${operation}`,
      ) ?? [],
      riskReduction: [
        "Accès chiffré et révocable",
        "Permissions minimales vérifiées avant chaque opération",
      ],
      expectedTimeSaving: null,
      confidence: connection.environment === "mock"
        ? "fixture_locale"
        : connection.environment === "sandbox"
          ? "preuve_sandbox"
          : "preuve_production",
      unavailableInputs: [
        "Volume réel de tâches manuelles",
        "Durée moyenne mesurée par tâche",
        "Coût horaire validé",
      ],
    } satisfies ConnectionValueSummary;
  });
}
