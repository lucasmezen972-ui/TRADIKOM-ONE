export const tenantRlsPolicyOperations = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
] as const;

export function hasCompleteTenantRlsPolicyCoverage(input: {
  rlsEnabled: boolean;
  policyCommands: readonly string[];
}) {
  if (!input.rlsEnabled) return false;

  const commands = new Set(
    input.policyCommands.map((command) => command.toUpperCase()),
  );
  return (
    commands.has("ALL") ||
    tenantRlsPolicyOperations.every((operation) => commands.has(operation))
  );
}

const tenantRlsPolicyOperationsSql = tenantRlsPolicyOperations
  .map((operation) => `'${operation}'`)
  .join(", ");

export const tenantRlsCoverageGapsSql = `
  select columns.table_name
  from information_schema.columns as columns
  join pg_class as tables on tables.relname = columns.table_name
  join pg_namespace as namespaces on namespaces.oid = tables.relnamespace
  where columns.table_schema = 'public'
    and columns.column_name = 'tenant_id'
    and namespaces.nspname = 'public'
    and (
      not tables.relrowsecurity
      or (
        not exists (
          select 1
          from pg_policies as policies
          where policies.schemaname = 'public'
            and policies.tablename = columns.table_name
            and policies.cmd = 'ALL'
        )
        and (
          select count(distinct policies.cmd)
          from pg_policies as policies
          where policies.schemaname = 'public'
            and policies.tablename = columns.table_name
            and policies.cmd in (${tenantRlsPolicyOperationsSql})
        ) < ${tenantRlsPolicyOperations.length}
      )
    )
  order by columns.table_name
`;
