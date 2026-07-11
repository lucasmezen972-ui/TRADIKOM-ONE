import type { DbClient } from "@/lib/db";
import {
  findContactById,
  listActivities,
  listContacts,
  listLeads,
  listTasks,
} from "@/modules/crm/repository";
import { tenantContactLookupSchema } from "@/modules/crm/schemas";
import { assertTenantAccess } from "@/modules/tenants";

export async function getCrm(db: DbClient, userId: string, tenantId: string) {
  await assertTenantAccess(db, userId, tenantId);
  const [contacts, leads, tasks, activities] = await Promise.all([
    listContacts(db, tenantId),
    listLeads(db, tenantId),
    listTasks(db, tenantId),
    listActivities(db, tenantId, 20),
  ]);

  return {
    contacts,
    leads,
    tasks,
    activities,
  };
}

export async function getTenantActivities(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  return listActivities(db, tenantId, limit);
}

export async function findContactForTenant(
  db: DbClient,
  userId: string,
  tenantId: string,
  contactId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const parsed = tenantContactLookupSchema.parse({ contactId });

  return findContactById(db, tenantId, parsed.contactId);
}
