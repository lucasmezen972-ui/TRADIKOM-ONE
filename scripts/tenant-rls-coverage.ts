export const tenantRlsPolicyOperations = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
] as const;

export type TenantRlsPolicy = {
  command: string;
  roles: readonly string[];
  usingExpression: string | null;
  withCheckExpression: string | null;
  permissive?: boolean;
};

const approvedActorAccessHelpers = [
  "app_actor_can_access_conversation_thread",
  "app_actor_can_access_conversation_message",
  "app_actor_can_access_conversation_plan",
  "app_actor_can_access_workflow_run",
  "app_actor_can_access_domain_event",
] as const;
const approvedActorAccessHelperNames = new Set<string>(
  approvedActorAccessHelpers,
);
const approvedActorAccessHelperSqlPattern = `(${approvedActorAccessHelpers.join("|")})`;

export function hasCompleteTenantRlsPolicyCoverage(input: {
  rlsEnabled: boolean;
  policies: readonly TenantRlsPolicy[];
}) {
  if (!input.rlsEnabled) return false;

  const permissivePolicies = input.policies.filter(
    (policy) => policy.permissive !== false,
  );
  const publicPermissivePolicies = input.policies.filter(
    (policy) =>
      policy.permissive !== false &&
      policy.roles.some((role) => role.toLowerCase() === "public"),
  );
  return (
    tenantRlsPolicyOperations.every((operation) =>
      publicPermissivePolicies.some((policy) =>
        policyCoversOperation(policy, operation),
      ),
    ) &&
    permissivePolicies.every((policy) => {
      const operations = operationsForPolicy(policy.command);
      return (
        operations.length > 0 &&
        operations.every((operation) => policyHasSafePredicates(policy, operation))
      );
    })
  );
}

function operationsForPolicy(command: string) {
  const normalized = command.toUpperCase();
  if (normalized === "ALL") return tenantRlsPolicyOperations;
  return tenantRlsPolicyOperations.filter((operation) => operation === normalized);
}

function policyCoversOperation(
  policy: TenantRlsPolicy,
  operation: (typeof tenantRlsPolicyOperations)[number],
) {
  const command = policy.command.toUpperCase();
  if (
    !policy.roles.some((role) => role.toLowerCase() === "public") ||
    (command !== "ALL" && command !== operation)
  ) {
    return false;
  }
  return policyHasSafePredicates(policy, operation);
}

function policyHasSafePredicates(
  policy: TenantRlsPolicy,
  operation: (typeof tenantRlsPolicyOperations)[number],
) {
  if (operation === "SELECT" || operation === "DELETE") {
    return isTenantBoundExpression(policy.usingExpression);
  }
  if (operation === "INSERT") {
    return isTenantBoundExpression(policy.withCheckExpression);
  }
  return (
    isTenantBoundExpression(policy.usingExpression) &&
    isTenantBoundExpression(policy.withCheckExpression)
  );
}

function isTenantBoundExpression(expression: string | null) {
  if (!expression) return false;
  const normalized = stripOuterParentheses(
    expression.toLowerCase().replace(/\s+/g, " ").trim(),
  );
  if (normalized === "app_is_system()") return true;

  const branches = splitTopLevel(normalized, "or");
  if (branches.length !== 2) return false;
  const left = stripOuterParentheses(branches[0] ?? "");
  const right = stripOuterParentheses(branches[1] ?? "");
  if (left === "app_is_system()") return isTenantGuard(right);
  if (right === "app_is_system()") return isTenantGuard(left);
  return false;
}

function isTenantGuard(expression: string) {
  const normalized = stripOuterParentheses(expression);
  if (isCurrentTenantEquality(normalized) || isActorAccessCall(normalized)) {
    return true;
  }
  const conjuncts = splitTopLevel(normalized, "and");
  if (conjuncts.length < 2) return false;
  return conjuncts.some((conjunct) => {
    const guard = stripOuterParentheses(conjunct);
    return isCurrentTenantEquality(guard) || isActorAccessCall(guard);
  });
}

function isCurrentTenantEquality(expression: string) {
  return /^(?:[a-z_][a-z0-9_]*\.)?tenant_id\s*=\s*app_current_tenant_id\(\)$/.test(
    expression,
  ) || /^app_current_tenant_id\(\)\s*=\s*(?:[a-z_][a-z0-9_]*\.)?tenant_id$/.test(
    expression,
  );
}

function isActorAccessCall(expression: string) {
  const match = expression.match(
    /^([a-z_][a-z0-9_]*)\s*\(([\s\S]*)\)$/,
  );
  if (!match || !approvedActorAccessHelperNames.has(match[1] ?? "")) {
    return false;
  }
  const [firstArgument] = splitTopLevel(match[2] ?? "", ",");
  return /^(?:[a-z_][a-z0-9_]*\.)?tenant_id$/.test(
    stripOuterParentheses(firstArgument ?? ""),
  );
}

function splitTopLevel(expression: string, separator: "and" | "or" | ",") {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (character === "'") {
      if (quoted && expression[index + 1] === "'") {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth !== 0) continue;

    if (separator === "," && character === ",") {
      parts.push(expression.slice(start, index).trim());
      start = index + 1;
      continue;
    }
    if (
      separator !== "," &&
      expression.slice(index, index + separator.length) === separator &&
      !/[a-z0-9_]/.test(expression[index - 1] ?? "") &&
      !/[a-z0-9_]/.test(expression[index + separator.length] ?? "")
    ) {
      parts.push(expression.slice(start, index).trim());
      start = index + separator.length;
      index += separator.length - 1;
    }
  }
  parts.push(expression.slice(start).trim());
  return parts;
}

function stripOuterParentheses(expression: string) {
  let normalized = expression.trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    let depth = 0;
    let quoted = false;
    let wrapsWholeExpression = true;
    for (let index = 0; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (character === "'") {
        if (quoted && normalized[index + 1] === "'") {
          index += 1;
          continue;
        }
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0 && index < normalized.length - 1) {
        wrapsWholeExpression = false;
        break;
      }
    }
    if (!wrapsWholeExpression || depth !== 0) break;
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

const safePredicateSql = (alias: string, column: "qual" | "with_check") => {
  const compact = `regexp_replace(lower(${alias}.${column}), '[[:space:]]', '', 'g')`;
  return `
    ${alias}.${column} is not null
    and (
      ${compact} ~ '^\\(*app_is_system\\(\\)\\)*$'
      or ${compact} ~ '^\\(app_is_system\\(\\)or\\(tenant_id=app_current_tenant_id\\(\\)\\)\\)$'
      or ${compact} ~ '^\\(\\(tenant_id=app_current_tenant_id\\(\\)\\)orapp_is_system\\(\\)\\)$'
      or ${compact} ~ '^\\(app_is_system\\(\\)or${approvedActorAccessHelperSqlPattern}\\(tenant_id(,[^()]*)?\\)\\)$'
      or ${compact} ~ '^\\(${approvedActorAccessHelperSqlPattern}\\(tenant_id(,[^()]*)?\\)orapp_is_system\\(\\)\\)$'
      or ${compact} ~ '^\\(app_is_system\\(\\)or\\(\\(tenant_id=app_current_tenant_id\\(\\)\\)and.+\\)\\)$'
      or ${compact} ~ '^\\(\\(\\(tenant_id=app_current_tenant_id\\(\\)\\)and.+\\)orapp_is_system\\(\\)\\)$'
    )`;
};

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
      or exists (
        select 1
        from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'))
          as required_operations(operation)
        where not exists (
          select 1
          from pg_policies as policies
          where policies.schemaname = 'public'
            and policies.tablename = columns.table_name
            and policies.cmd in ('ALL', required_operations.operation)
            and policies.permissive = 'PERMISSIVE'
            and 'public' = any(policies.roles)
            and case required_operations.operation
              when 'SELECT' then (${safePredicateSql("policies", "qual")})
              when 'DELETE' then (${safePredicateSql("policies", "qual")})
              when 'INSERT' then (${safePredicateSql("policies", "with_check")})
              when 'UPDATE' then (
                (${safePredicateSql("policies", "qual")})
                and (${safePredicateSql("policies", "with_check")})
              )
              else false
            end
        )
      )
      or exists (
        select 1
        from pg_policies as policies
        where policies.schemaname = 'public'
          and policies.tablename = columns.table_name
          and policies.permissive = 'PERMISSIVE'
          and (
            (
              policies.cmd in ('ALL', 'SELECT', 'UPDATE', 'DELETE')
              and not (${safePredicateSql("policies", "qual")})
            )
            or (
              policies.cmd in ('ALL', 'INSERT', 'UPDATE')
              and not (${safePredicateSql("policies", "with_check")})
            )
          )
      )
    )
  order by columns.table_name
`;
