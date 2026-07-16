import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { ImportError } from "@/modules/imports/errors";
import {
  countPendingImportRows,
  deleteImportTarget,
  findImportJob,
  insertImportPreview,
  insertImportTarget,
  insertPreviewRow,
  listCommittedImportTargets,
  listImportJobs,
  listImportRows,
  listPendingImportRows,
  loadImportReferenceData,
  mapImportJob,
  mapImportRowRecord,
  markImportRolledBack,
  markImportRowCommitted,
  updateImportAfterBatch,
} from "@/modules/imports/repository";
import {
  mapImportRow,
  normalizeHeader,
  parseImportFile,
} from "@/modules/imports/parsers";
import {
  importCommitSchema,
  importJobReferenceSchema,
  importPreviewSchema,
  importTargetFields,
  requiredImportTargetFields,
  type ImportEntity,
  type ImportPreviewInput,
} from "@/modules/imports/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const importRoles = ["owner", "administrator", "manager"] as const;

export async function previewUniversalImport(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ImportPreviewInput & { buffer: Buffer },
) {
  const parsedInput = importPreviewSchema.parse(input);
  assertMapping(parsedInput.entityType, parsedInput.mapping);
  const parsedFile = await parseImportFile({
    buffer: input.buffer,
    format: parsedInput.format,
    contentType: parsedInput.contentType,
    sheetName: parsedInput.sheetName,
  });
  assertMappedHeaders(parsedFile.headers, parsedInput.mapping);

  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...importRoles]);
    const references = await loadImportReferenceData(transaction, tenantId);
    const seen = new Set<string>();
    const importId = id("import");
    const now = nowIso();
    const rows = parsedFile.rows.map((row, index) => {
      const mapped = normalizeMappedData(
        parsedInput.entityType,
        mapImportRow(row, parsedInput.mapping),
      );
      const validation = validateMappedData(
        parsedInput.entityType,
        mapped,
        references,
        seen,
      );
      return {
        id: id("importrow"),
        rowNumber: index + 2,
        data: mapped,
        ...validation,
      };
    });
    const report = {
      total: rows.length,
      valid: rows.filter((row) => row.status === "valid").length,
      duplicates: rows.filter((row) => row.status === "duplicate").length,
      invalid: rows.filter((row) => row.status === "invalid").length,
      imported: 0,
      rolledBack: 0,
    };

    await insertImportPreview(transaction, {
      id: importId,
      tenantId,
      entityType: parsedInput.entityType,
      format: parsedInput.format,
      fileName: safeFileName(parsedInput.fileName),
      contentType: parsedInput.contentType,
      fileSizeBytes: input.buffer.length,
      mapping: parsedInput.mapping,
      headers: parsedFile.headers,
      totalRows: rows.length,
      report,
      createdBy: userId,
      now,
    });
    for (const row of rows) {
      await insertPreviewRow(transaction, {
        id: row.id,
        tenantId,
        importId,
        rowNumber: row.rowNumber,
        status: row.status,
        safeData: row.data,
        error: row.error,
        now,
      });
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "import.preview_validated",
      targetType: "import",
      targetId: importId,
      metadata: {
        entityType: parsedInput.entityType,
        format: parsedInput.format,
        fileSizeBytes: input.buffer.length,
        selectedSheet: parsedFile.selectedSheet,
        report,
      },
    });
    return {
      id: importId,
      entityType: parsedInput.entityType,
      format: parsedInput.format,
      fileName: safeFileName(parsedInput.fileName),
      headers: parsedFile.headers,
      selectedSheet: parsedFile.selectedSheet,
      status: "validated" as const,
      report,
      rows: rows.slice(0, 50),
    };
  });
}

export async function commitUniversalImportBatch(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { importId: string; batchSize?: number },
) {
  const parsed = importCommitSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...importRoles]);
    const jobRow = await findImportJob(transaction, tenantId, parsed.importId);
    if (!jobRow) throw new ImportError("import_not_found", "Import introuvable.");
    if (!["validated", "processing"].includes(jobRow.status)) {
      throw new ImportError(
        "import_not_committable",
        "Cet import ne peut plus être finalisé.",
      );
    }

    const rows = await listPendingImportRows(
      transaction,
      tenantId,
      parsed.importId,
      parsed.batchSize,
    );
    let imported = 0;
    let duplicates = 0;
    for (const row of rows) {
      const data = mapImportRowRecord(row).data;
      const targetId = id(entityPrefix(jobRow.entity_type));
      const insertedId = await insertImportTarget(transaction, {
        tenantId,
        userId,
        entityType: jobRow.entity_type,
        targetId,
        data,
        now: nowIso(),
      });
      if (insertedId) imported += 1;
      else duplicates += 1;
      await markImportRowCommitted(transaction, {
        tenantId,
        importId: parsed.importId,
        rowId: row.id,
        status: insertedId ? "imported" : "duplicate",
        targetId: insertedId,
      });
    }

    const remaining = await countPendingImportRows(
      transaction,
      tenantId,
      parsed.importId,
    );
    const processedRows = Number(jobRow.total_rows) - remaining;
    const previousReport = mapImportJob(jobRow).report;
    const report = {
      ...previousReport,
      imported: Number(previousReport.imported ?? 0) + imported,
      duplicates: Number(previousReport.duplicates ?? 0) + duplicates,
    };
    const status = remaining === 0 ? "completed" : "processing";
    await updateImportAfterBatch(transaction, {
      tenantId,
      importId: parsed.importId,
      status,
      processedRows,
      report,
      now: nowIso(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: status === "completed" ? "import.completed" : "import.batch_processed",
      targetType: "import",
      targetId: parsed.importId,
      metadata: { batchSize: rows.length, imported, duplicates, remaining },
    });
    return { importId: parsed.importId, status, processedRows, remaining, report };
  });
}

export async function rollbackUniversalImport(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { importId: string },
) {
  const parsed = importJobReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...importRoles]);
    const job = await findImportJob(transaction, tenantId, parsed.importId);
    if (!job) throw new ImportError("import_not_found", "Import introuvable.");
    if (!["processing", "completed"].includes(job.status)) {
      throw new ImportError(
        "import_not_rollbackable",
        "Cet import ne peut pas être annulé.",
      );
    }
    const targets = await listCommittedImportTargets(
      transaction,
      tenantId,
      parsed.importId,
    );
    for (const target of targets) {
      const deleted = await deleteImportTarget(
        transaction,
        tenantId,
        job.entity_type,
        target.target_id,
      );
      if (!deleted) {
        throw new ImportError(
          "rollback_conflict",
          "L'annulation a été interrompue car une donnée importée a changé.",
        );
      }
    }
    await markImportRolledBack(transaction, {
      tenantId,
      importId: parsed.importId,
      now: nowIso(),
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "import.rolled_back",
      targetType: "import",
      targetId: parsed.importId,
      metadata: { deletedTargets: targets.length },
    });
    return { importId: parsed.importId, status: "rolled_back" as const };
  });
}

export async function getImportWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await assertTenantAccess(db, userId, tenantId);
  const jobs = await listImportJobs(db, tenantId);
  return {
    canManage: importRoles.includes(role as (typeof importRoles)[number]),
    jobs: await Promise.all(
      jobs.map(async (job) => ({
        ...mapImportJob(job),
        rows: (await listImportRows(db, tenantId, job.id, 10)).map(
          mapImportRowRecord,
        ),
      })),
    ),
  };
}

function assertMapping(
  entityType: ImportEntity,
  mapping: Record<string, string>,
) {
  const allowed = new Set(importTargetFields[entityType]);
  const unknown = Object.keys(mapping).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new ImportError(
      "unknown_mapping_field",
      "La correspondance contient un champ cible non autorisé.",
    );
  }
  const missing = requiredImportTargetFields[entityType].filter(
    (field) => !mapping[field],
  );
  if (missing.length > 0) {
    throw new ImportError(
      "missing_mapping",
      `Correspondance requise : ${missing.join(", ")}.`,
    );
  }
}

function assertMappedHeaders(headers: string[], mapping: Record<string, string>) {
  const available = new Set(headers);
  const missing = Object.values(mapping).filter(
    (source) => !available.has(normalizeHeader(source)),
  );
  if (missing.length > 0) {
    throw new ImportError(
      "source_header_not_found",
      `Colonnes introuvables : ${missing.join(", ")}.`,
    );
  }
}

function normalizeMappedData(
  entityType: ImportEntity,
  data: Record<string, string>,
) {
  if (data.email) data.email = data.email.toLowerCase();
  if (data.contact_email) data.contact_email = data.contact_email.toLowerCase();
  if (data.domain) data.domain = normalizeDomain(data.domain);
  if (data.sku) data.sku = data.sku.toUpperCase();
  if (data.price) data.price_cents = String(parseMoneyToCents(data.price));
  if (data.value) data.value_cents = String(parseMoneyToCents(data.value));
  return Object.fromEntries(
    Object.entries(data)
      .filter(([field]) => importTargetFields[entityType].includes(field) || field.endsWith("_cents"))
      .map(([field, value]) => [field, value.slice(0, 500)]),
  );
}

function validateMappedData(
  entityType: ImportEntity,
  data: Record<string, string>,
  references: Awaited<ReturnType<typeof loadImportReferenceData>>,
  seen: Set<string>,
): { status: "valid" | "invalid" | "duplicate"; error: string | null } {
  const missing = requiredImportTargetFields[entityType].filter(
    (field) => !data[field],
  );
  if (missing.length > 0) {
    return { status: "invalid", error: `Champs manquants : ${missing.join(", ")}` };
  }
  if (entityType === "contacts" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return { status: "invalid", error: "Adresse e-mail invalide" };
  }
  if (entityType === "opportunities") {
    if (!references.contactEmails.has(data.contact_email)) {
      return { status: "invalid", error: "Contact associé introuvable" };
    }
    if (!references.stageNames.has(data.stage_name.toLowerCase())) {
      return { status: "invalid", error: "Étape de pipeline introuvable" };
    }
  }
  if (
    (entityType === "products" && Number(data.price_cents) < 0) ||
    (entityType === "opportunities" && Number(data.value_cents) < 0)
  ) {
    return { status: "invalid", error: "Le montant ne peut pas être négatif" };
  }

  const duplicateKey = importDuplicateKey(entityType, data);
  const existing =
    (entityType === "contacts" && references.contactEmails.has(data.email)) ||
    (entityType === "companies" &&
      (references.companyNames.has(data.name.toLowerCase()) ||
        Boolean(data.domain && references.companyDomains.has(data.domain)))) ||
    (entityType === "products" && references.productSkus.has(data.sku.toLowerCase()));
  if (existing || seen.has(duplicateKey)) {
    return { status: "duplicate", error: "Doublon détecté pendant la validation" };
  }
  seen.add(duplicateKey);
  return { status: "valid", error: null };
}

function importDuplicateKey(entityType: ImportEntity, data: Record<string, string>) {
  if (entityType === "contacts") return `contact:${data.email}`;
  if (entityType === "companies") return `company:${data.domain || data.name.toLowerCase()}`;
  if (entityType === "products") return `product:${data.sku.toLowerCase()}`;
  return `opportunity:${data.contact_email}:${data.stage_name.toLowerCase()}:${data.value_cents}`;
}

function parseMoneyToCents(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return -1;
  return Math.round(amount * 100);
}

function normalizeDomain(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function safeFileName(value: string) {
  return value.replace(/[\\/\0]/g, "_").slice(0, 180);
}

function entityPrefix(entityType: ImportEntity) {
  return {
    contacts: "contact",
    companies: "company",
    products: "product",
    opportunities: "opportunity",
  }[entityType];
}
