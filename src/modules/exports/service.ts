import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { correlationId, id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { ExportError } from "@/modules/exports/errors";
import { formatExport } from "@/modules/exports/formatter";
import {
  cancelExportJob,
  completeExportJob,
  expireExportJob,
  failExportJob,
  findExportJob,
  insertExportJob,
  listExportJobs,
  listExportSourceRows,
  mapExportJob,
  markExportDownloaded,
  markExportProcessing,
} from "@/modules/exports/repository";
import {
  createExportSchema,
  exportFieldDefinitions,
  exportJobReferenceSchema,
  type CreateExportInput,
  type ExportEntity,
} from "@/modules/exports/schemas";
import { assertTenantAccess } from "@/modules/tenants";
import { enqueueDomainEvent } from "@/modules/workflows/engine";

export const exportGenerationRequestedEventType = "export.generate_requested";
export const exportRowLimit = 5_000;
const exportRangeLimitMs = 366 * 24 * 60 * 60 * 1_000;
const exportRetentionMs = 24 * 60 * 60 * 1_000;
const exportRoles = ["owner", "administrator", "manager"] as const;

export async function createUniversalExport(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CreateExportInput,
) {
  const parsed = createExportSchema.parse(input);
  assertExportFields(parsed.entityType, parsed.selectedFields);
  const dateFrom = new Date(parsed.dateFrom);
  const dateTo = new Date(parsed.dateTo);
  if (dateTo.getTime() < dateFrom.getTime()) {
    throw new ExportError(
      "invalid_export_range",
      "La date de fin doit être postérieure à la date de début.",
    );
  }
  if (dateTo.getTime() - dateFrom.getTime() > exportRangeLimitMs) {
    throw new ExportError(
      "export_range_too_large",
      "La période d'export ne peut pas dépasser 366 jours.",
    );
  }
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...exportRoles]);
    const exportId = id("export");
    const eventId = id("event");
    const now = nowIso();
    const expiresAt = new Date(Date.now() + exportRetentionMs).toISOString();
    await insertExportJob(transaction, {
      id: exportId,
      tenantId,
      entityType: parsed.entityType,
      format: parsed.format,
      selectedFields: parsed.selectedFields,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      expiresAt,
      createdBy: userId,
      now,
    });
    await enqueueDomainEvent(transaction, {
      id: eventId,
      tenantId,
      actorId: userId,
      type: exportGenerationRequestedEventType,
      payload: { exportId },
      idempotencyKey: `export:${exportId}`,
      correlationId: correlationId(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "export.queued",
      targetType: "export",
      targetId: exportId,
      metadata: {
        entityType: parsed.entityType,
        format: parsed.format,
        selectedFields: parsed.selectedFields,
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
        expiresAt,
      },
    });
    return {
      id: exportId,
      status: "queued" as const,
      expiresAt,
    };
  });
}

export async function processUniversalExportJob(
  db: DbClient,
  actorId: string,
  tenantId: string,
  exportId: string,
) {
  try {
    return await withTenantDbTransaction(
      db,
      tenantId,
      actorId,
      async (transaction) => {
        const job = await findExportJob(transaction, tenantId, exportId);
        if (!job) throw new ExportError("export_not_found", "Export introuvable.");
        if (job.status === "completed") {
          return { exportId, status: "completed" as const, idempotentReplay: true };
        }
        if (["cancelled", "failed", "expired"].includes(job.status)) {
          return {
            exportId,
            status: job.status as "cancelled" | "failed" | "expired",
            idempotentReplay: true,
          };
        }
        if (job.status !== "queued") {
          throw new ExportError(
            "export_not_processable",
            "Cet export ne peut plus être généré.",
          );
        }
        const now = nowIso();
        await markExportProcessing(transaction, { tenantId, exportId, now });
        const rows = await listExportSourceRows(transaction, {
          tenantId,
          entityType: job.entity_type,
          dateFrom: job.date_from,
          dateTo: job.date_to,
          limit: exportRowLimit + 1,
        });
        if (rows.length > exportRowLimit) {
          throw new ExportError(
            "export_row_limit_exceeded",
            `L'export dépasse la limite de ${exportRowLimit} lignes.`,
          );
        }
        const selectedFields = mapExportJob(job).selectedFields;
        const formatted = await formatExport({
          entityType: job.entity_type,
          format: job.format,
          selectedFields,
          rows,
        });
        const fileName = buildExportFileName(job.entity_type, job.format, now);
        await completeExportJob(transaction, {
          tenantId,
          exportId,
          rowCount: rows.length,
          content: formatted.content,
          contentType: formatted.contentType,
          fileName,
          now,
        });
        await recordAuditLog(transaction, {
          tenantId,
          actorId,
          action: "export.completed",
          targetType: "export",
          targetId: exportId,
          metadata: {
            entityType: job.entity_type,
            format: job.format,
            rowCount: rows.length,
            contentBytes: formatted.content.length,
          },
        });
        return {
          exportId,
          status: "completed" as const,
          rowCount: rows.length,
          idempotentReplay: false,
        };
      },
    );
  } catch (error) {
    if (!(error instanceof ExportError)) throw error;
    await withTenantDbTransaction(db, tenantId, actorId, async (transaction) => {
      await failExportJob(transaction, {
        tenantId,
        exportId,
        errorCode: error.code,
        now: nowIso(),
      });
      await recordAuditLog(transaction, {
        tenantId,
        actorId,
        action: "export.failed",
        targetType: "export",
        targetId: exportId,
        metadata: { errorCode: error.code },
      });
    });
    return { exportId, status: "failed" as const, errorCode: error.code };
  }
}

export async function cancelUniversalExport(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { exportId: string },
) {
  const parsed = exportJobReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...exportRoles]);
    const job = await findExportJob(transaction, tenantId, parsed.exportId);
    if (!job) throw new ExportError("export_not_found", "Export introuvable.");
    if (!["queued", "processing", "completed"].includes(job.status)) {
      throw new ExportError(
        "export_not_cancellable",
        "Cet export ne peut pas être annulé.",
      );
    }
    await cancelExportJob(transaction, {
      tenantId,
      exportId: parsed.exportId,
      now: nowIso(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "export.cancelled",
      targetType: "export",
      targetId: parsed.exportId,
      metadata: { contentDeleted: true },
    });
    return { exportId: parsed.exportId, status: "cancelled" as const };
  });
}

export async function getUniversalExportDownload(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { exportId: string },
) {
  const parsed = exportJobReferenceSchema.parse(input);
  const result = await withTenantDbTransaction(
    db,
    tenantId,
    userId,
    async (transaction) => {
      await assertTenantAccess(transaction, userId, tenantId, [...exportRoles]);
      const job = await findExportJob(transaction, tenantId, parsed.exportId);
      if (!job) throw new ExportError("export_not_found", "Export introuvable.");
      if (job.status !== "completed" || !job.safe_content || !job.content_type || !job.file_name) {
        throw new ExportError(
          "export_not_available",
          "Le fichier d'export n'est pas disponible.",
        );
      }
      if (new Date(job.expires_at).getTime() <= Date.now()) {
        await expireExportJob(transaction, {
          tenantId,
          exportId: job.id,
          now: nowIso(),
        });
        await recordAuditLog(transaction, {
          tenantId,
          actorId: userId,
          action: "export.expired",
          targetType: "export",
          targetId: job.id,
          metadata: { contentDeleted: true },
        });
        return { expired: true as const };
      }
      await markExportDownloaded(transaction, {
        tenantId,
        exportId: job.id,
        now: nowIso(),
      });
      await recordAuditLog(transaction, {
        tenantId,
        actorId: userId,
        action: "export.downloaded",
        targetType: "export",
        targetId: job.id,
        metadata: { rowCount: Number(job.row_count), format: job.format },
      });
      return {
        expired: false as const,
        content: Buffer.from(job.safe_content, "base64"),
        contentType: job.content_type,
        fileName: job.file_name,
      };
    },
  );
  if (result.expired) {
    throw new ExportError("export_expired", "Le lien d'export a expiré.");
  }
  return result;
}

export async function getExportWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  return {
    canManage: exportRoles.includes(role as (typeof exportRoles)[number]),
    jobs: (await listExportJobs(db, tenantId)).map(mapExportJob),
  };
}

function assertExportFields(entityType: ExportEntity, selectedFields: string[]) {
  const allowed = new Set(Object.keys(exportFieldDefinitions[entityType]));
  if (
    new Set(selectedFields).size !== selectedFields.length ||
    selectedFields.some((field) => !allowed.has(field))
  ) {
    throw new ExportError(
      "export_field_not_allowed",
      "Un champ sélectionné n'est pas disponible pour cet export.",
    );
  }
}

function buildExportFileName(
  entityType: ExportEntity,
  format: "csv" | "xlsx" | "json",
  now: string,
) {
  return `tradikom-${entityType.replaceAll("_", "-")}-${now.slice(0, 10)}.${format}`;
}
