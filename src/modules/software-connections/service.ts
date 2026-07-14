import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { nowIso, safeJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { OAuthError } from "@/modules/oauth/errors";
import {
  consumePendingOAuthStates,
  revokeActiveOAuthCredentials,
} from "@/modules/oauth/repository";
import { softwareConnectionReferenceSchema } from "@/modules/oauth/schemas";
import {
  findSoftwareConnection,
  listSoftwareConnections,
  markSoftwareConnectionDisconnected,
} from "@/modules/software-connections/repository";
import { assertTenantAccess } from "@/modules/tenants";

const connectionAdminRoles = ["owner", "administrator"] as const;

export async function getSoftwareConnectionWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  const connections = await listSoftwareConnections(db, tenantId);
  return {
    canManage: connectionAdminRoles.includes(
      role as (typeof connectionAdminRoles)[number],
    ),
    available: [
      {
        key: "mock_business",
        name: "Mock Business",
        vendor: "TRADIKOM ONE CI",
        confidence: 100,
        officialSource: "Fixture locale contrôlée",
        status: "oauth_connection_available" as const,
        authenticationMethod: "OAuth 2.0 Authorization Code + PKCE",
        environment: "mock" as const,
        scopes: ["contacts.read", "profile.read"],
        supportedEntities: ["contacts", "profil"],
        readCapabilities: ["Lire les contacts", "Lire le profil du compte"],
        writeCapabilities: [],
        limitations: [
          "Aucun réseau externe",
          "Aucune donnée client de production",
          "Aucune écriture",
        ],
      },
    ],
    connections: connections.map((connection) => ({
      id: connection.id,
      softwareKey: connection.software_key,
      softwareName: connection.software_name,
      providerKey: connection.provider_key,
      environment: connection.environment,
      status: connection.status,
      accountLabel: connection.account_label,
      scopes: safeJson<string[]>(connection.scopes, []),
      connectedAt: connection.connected_at,
      disconnectedAt: connection.disconnected_at,
      credentialExpiresAt: connection.credential_expires_at ?? null,
      credentialKeyVersion: connection.credential_key_version ?? null,
    })),
  };
}

export async function disconnectSoftwareConnection(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { connectionId: string },
) {
  const parsed = softwareConnectionReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...connectionAdminRoles,
    ]);
    const connection = await findSoftwareConnection(
      transaction,
      tenantId,
      parsed.connectionId,
    );
    if (!connection) {
      throw new OAuthError(
        "oauth_connection_not_found",
        "La connexion logicielle est introuvable.",
      );
    }
    const now = nowIso();
    await revokeActiveOAuthCredentials(transaction, {
      tenantId,
      connectionId: connection.id,
      now,
    });
    await consumePendingOAuthStates(transaction, {
      tenantId,
      connectionId: connection.id,
      consumedAt: now,
    });
    await markSoftwareConnectionDisconnected(transaction, {
      tenantId,
      connectionId: connection.id,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "software_connection.disconnected",
      targetType: "software_connection",
      targetId: connection.id,
      metadata: {
        providerKey: connection.provider_key,
        environment: connection.environment,
        credentialsRevoked: true,
        secretStoredInAudit: false,
      },
    });
    return {
      connectionId: connection.id,
      status: "disconnected" as const,
      credentialsRevoked: true,
    };
  });
}
