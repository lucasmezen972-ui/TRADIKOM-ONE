do $$
begin
  if exists (
    select 1 from conversation_participants participant
    where participant.id ~ '^orchestrator_participant_'
      and (
        participant.id !~ '^orchestrator_participant_[a-f0-9]{32}$'
        or substring(participant.id from 26) <>
          substring(
            encode(sha256(convert_to(participant.tenant_id, 'UTF8')), 'hex')
            from 1 for 32
          )
        or participant.role <> 'system'
        or participant.display_name is distinct from 'TRADIKOM ONE'
      )
  )
  or exists (
    select 1
    from conversation_channel_identities identity
    join conversation_participants participant
      on participant.tenant_id = identity.tenant_id
     and participant.id = identity.participant_id
    where (participant.role = 'system') is distinct from
      (identity.role = 'system')
  )
  or exists (
    select 1 from conversation_channel_identities identity
    where (
      identity.id ~ '^orchestrator_identity_'
      or identity.participant_id ~ '^orchestrator_participant_'
      or identity.adapter_key = 'orchestrator-mock'
      or identity.external_subject_id = 'tradikom-one-orchestrator'
    )
    and not (
      identity.id ~ '^orchestrator_identity_[a-f0-9]{32}$'
      and identity.participant_id ~
        '^orchestrator_participant_[a-f0-9]{32}$'
      and substring(identity.id from 23) =
        substring(identity.participant_id from 26)
      and substring(identity.id from 23) =
        substring(
          encode(sha256(convert_to(identity.tenant_id, 'UTF8')), 'hex')
          from 1 for 32
        )
      and identity.channel_kind = 'test'
      and identity.adapter_key = 'orchestrator-mock'
      and identity.external_subject_id = 'tradikom-one-orchestrator'
      and identity.display_name is not distinct from 'TRADIKOM ONE'
      and identity.role = 'system'
      and identity.state = 'active'
    )
  )
  or exists (
    select 1 from conversation_messages message
    where (
      message.idempotency_key ~ '^orchestrator:'
      or message.adapter_key = 'orchestrator-mock'
      or message.channel_identity_id ~ '^orchestrator_identity_'
    )
    and not (
      message.idempotency_key ~
        '^orchestrator:conversation_action_plan_[a-f0-9]{32}:(proposal|approved|rejected|executed)$'
      and message.external_message_id is not distinct from
        substring(message.idempotency_key from 14)
      and message.adapter_key = 'orchestrator-mock'
      and message.channel_identity_id ~
        '^orchestrator_identity_[a-f0-9]{32}$'
      and message.channel_identity_id =
        'orchestrator_identity_' || substring(
          encode(sha256(convert_to(message.tenant_id, 'UTF8')), 'hex')
          from 1 for 32
        )
      and message.direction = 'internal'
      and message.kind = case
        when message.idempotency_key ~ ':proposal$' then 'plan'
        when message.idempotency_key ~ ':(approved|rejected)$' then 'approval'
        when message.idempotency_key ~ ':executed$' then 'result'
      end
      and message.status = 'received'
      and message.safe_error_code is null
      and message.occurred_at = message.created_at
      and exists (
        select 1 from conversation_action_plans plan
        where plan.tenant_id = message.tenant_id
          and plan.id = split_part(message.idempotency_key, ':', 2)
          and plan.thread_id = message.thread_id
          and plan.source_message_id = message.causation_id
          and (
            (
              split_part(message.idempotency_key, ':', 3) = 'proposal'
              and message.text_content =
                plan.plan_json::jsonb ->> 'finalUserMessageDraft'
            )
            or (
              split_part(message.idempotency_key, ':', 3) = 'approved'
              and plan.approval_status in ('approved', 'executed')
              and plan.decided_at = message.created_at
              and message.text_content = 'Plan approuvé.'
            )
            or (
              split_part(message.idempotency_key, ':', 3) = 'rejected'
              and plan.approval_status = 'rejected'
              and plan.decided_at = message.created_at
              and (
                (
                  exists (
                    select 1 from conversation_action_plans child
                    where child.tenant_id = plan.tenant_id
                      and child.supersedes_plan_id = plan.id
                  )
                  and plan.decision_reason =
                    'Plan remplacé par une révision demandée.'
                  and message.text_content =
                    'Plan remplacé par une révision. Aucune action n’a été exécutée.'
                )
                or (
                  not exists (
                    select 1 from conversation_action_plans child
                    where child.tenant_id = plan.tenant_id
                      and child.supersedes_plan_id = plan.id
                  )
                  and message.text_content in ('Plan annulé.', 'Plan refusé.')
                )
              )
            )
            or (
              split_part(message.idempotency_key, ':', 3) = 'executed'
              and plan.approval_status = 'executed'
              and plan.updated_at = message.created_at
              and message.text_content =
                'Exécution mock terminée : toutes les étapes simulées ont été vérifiées. Aucun effet externe.'
              and exists (
                select 1 from workflow_runs run
                where run.tenant_id = plan.tenant_id
                  and run.workflow_key = 'conversation_plan:' || plan.id
                  and run.id = message.correlation_id
              )
            )
          )
      )
    )
  )
  or exists (
    select 1
    from conversation_message_attachments attachment
    join conversation_messages message
      on message.tenant_id = attachment.tenant_id
     and message.id = attachment.message_id
    where message.idempotency_key ~ '^orchestrator:'
       or message.adapter_key = 'orchestrator-mock'
       or message.channel_identity_id ~ '^orchestrator_identity_'
  )
  or exists (
    select 1 from conversation_message_route_hops hop
    where hop.adapter_key = 'orchestrator-mock'
       or hop.channel_identity_id ~ '^orchestrator_identity_'
  ) then
    raise exception 'orchestrator_internal_namespace_conflict';
  end if;
end;
$$;

create or replace function is_internal_conversation_identity(
  requested_tenant_id text,
  requested_identity_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select requested_identity_id ~ '^orchestrator_identity_'
    or not exists (
      select 1 from conversation_channel_identities identity
      where identity.tenant_id = requested_tenant_id
        and identity.id = requested_identity_id
        and not (
          identity.id ~ '^orchestrator_identity_'
          or identity.participant_id ~ '^orchestrator_participant_'
          or identity.adapter_key = 'orchestrator-mock'
          or identity.external_subject_id = 'tradikom-one-orchestrator'
          or identity.role = 'system'
        )
        and exists (
          select 1 from conversation_participants participant
          where participant.tenant_id = identity.tenant_id
            and participant.id = identity.participant_id
            and participant.id !~ '^orchestrator_participant_'
            and participant.role <> 'system'
        )
    );
$$;

create or replace function is_internal_conversation_message(
  requested_tenant_id text,
  requested_message_id text
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select not exists (
    select 1 from conversation_messages message
    where message.tenant_id = requested_tenant_id
      and message.id = requested_message_id
      and not (
        message.idempotency_key ~ '^orchestrator:'
        or message.adapter_key = 'orchestrator-mock'
        or message.channel_identity_id ~ '^orchestrator_identity_'
      )
  );
$$;

do $$
begin
  if exists (
    select 1 from channel_provider_deliveries delivery
    where is_internal_conversation_message(
      delivery.tenant_id,
      delivery.message_id
    )
      or is_internal_conversation_identity(
        delivery.tenant_id,
        delivery.channel_identity_id
      )
  )
  or exists (
    select 1 from channel_provider_secret_versions secret
    where secret.channel_identity_id is not null
      and is_internal_conversation_identity(
        secret.tenant_id,
        secret.channel_identity_id
      )
  )
  or exists (
    select 1 from channel_provider_identity_bindings binding
    where is_internal_conversation_identity(
      binding.tenant_id,
      binding.channel_identity_id
    )
  )
  or exists (
    select 1 from channel_provider_media_imports media_import
    where is_internal_conversation_message(
      media_import.tenant_id,
      media_import.message_id
    )
  ) then
    raise exception 'orchestrator_internal_consumer_conflict';
  end if;
end;
$$;

create or replace function enforce_conversation_message_identity_immutability()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_catalog
as $$
begin
  if new.channel_identity_id is distinct from old.channel_identity_id then
    raise exception 'conversation_message_identity_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists conversation_messages_identity_immutable
  on conversation_messages;
create trigger conversation_messages_identity_immutable
before update on conversation_messages
for each row execute function enforce_conversation_message_identity_immutability();

drop policy if exists conversation_participants_orchestrator_namespace_insert
  on conversation_participants;
create policy conversation_participants_orchestrator_namespace_insert
  on conversation_participants as restrictive for insert to public
  with check (
    app_is_system()
    or (id !~ '^orchestrator_participant_' and role <> 'system')
  );

drop policy if exists conversation_participants_orchestrator_namespace_update
  on conversation_participants;
create policy conversation_participants_orchestrator_namespace_update
  on conversation_participants as restrictive for update to public
  using (
    app_is_system()
    or (id !~ '^orchestrator_participant_' and role <> 'system')
  )
  with check (
    app_is_system()
    or (id !~ '^orchestrator_participant_' and role <> 'system')
  );

drop policy if exists conversation_participants_orchestrator_namespace_delete
  on conversation_participants;
create policy conversation_participants_orchestrator_namespace_delete
  on conversation_participants as restrictive for delete to public
  using (
    app_is_system()
    or (id !~ '^orchestrator_participant_' and role <> 'system')
  );

drop policy if exists conversation_channel_identities_orchestrator_namespace_insert
  on conversation_channel_identities;
create policy conversation_channel_identities_orchestrator_namespace_insert
  on conversation_channel_identities as restrictive for insert to public
  with check (
    app_is_system()
    or (
      id !~ '^orchestrator_identity_'
      and participant_id !~ '^orchestrator_participant_'
      and adapter_key <> 'orchestrator-mock'
      and external_subject_id <> 'tradikom-one-orchestrator'
      and role <> 'system'
      and exists (
        select 1 from conversation_participants participant
        where participant.tenant_id = conversation_channel_identities.tenant_id
          and participant.id = conversation_channel_identities.participant_id
          and participant.id !~ '^orchestrator_participant_'
          and participant.role <> 'system'
      )
    )
  );

drop policy if exists conversation_channel_identities_orchestrator_namespace_update
  on conversation_channel_identities;
create policy conversation_channel_identities_orchestrator_namespace_update
  on conversation_channel_identities as restrictive for update to public
  using (
    app_is_system()
    or (
      id !~ '^orchestrator_identity_'
      and participant_id !~ '^orchestrator_participant_'
      and adapter_key <> 'orchestrator-mock'
      and external_subject_id <> 'tradikom-one-orchestrator'
      and role <> 'system'
      and exists (
        select 1 from conversation_participants participant
        where participant.tenant_id = conversation_channel_identities.tenant_id
          and participant.id = conversation_channel_identities.participant_id
          and participant.id !~ '^orchestrator_participant_'
          and participant.role <> 'system'
      )
    )
  )
  with check (
    app_is_system()
    or (
      id !~ '^orchestrator_identity_'
      and participant_id !~ '^orchestrator_participant_'
      and adapter_key <> 'orchestrator-mock'
      and external_subject_id <> 'tradikom-one-orchestrator'
      and role <> 'system'
      and exists (
        select 1 from conversation_participants participant
        where participant.tenant_id = conversation_channel_identities.tenant_id
          and participant.id = conversation_channel_identities.participant_id
          and participant.id !~ '^orchestrator_participant_'
          and participant.role <> 'system'
      )
    )
  );

drop policy if exists conversation_channel_identities_orchestrator_namespace_delete
  on conversation_channel_identities;
create policy conversation_channel_identities_orchestrator_namespace_delete
  on conversation_channel_identities as restrictive for delete to public
  using (
    app_is_system()
    or (
      id !~ '^orchestrator_identity_'
      and participant_id !~ '^orchestrator_participant_'
      and adapter_key <> 'orchestrator-mock'
      and external_subject_id <> 'tradikom-one-orchestrator'
      and role <> 'system'
      and exists (
        select 1 from conversation_participants participant
        where participant.tenant_id = conversation_channel_identities.tenant_id
          and participant.id = conversation_channel_identities.participant_id
          and participant.id !~ '^orchestrator_participant_'
          and participant.role <> 'system'
      )
    )
  );

drop policy if exists conversation_thread_participants_orchestrator_namespace_insert
  on conversation_thread_participants;
create policy conversation_thread_participants_orchestrator_namespace_insert
  on conversation_thread_participants as restrictive for insert to public
  with check (
    app_is_system()
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists conversation_thread_participants_orchestrator_namespace_update
  on conversation_thread_participants;
create policy conversation_thread_participants_orchestrator_namespace_update
  on conversation_thread_participants as restrictive for update to public
  using (
    app_is_system()
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  )
  with check (
    app_is_system()
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists conversation_thread_participants_orchestrator_namespace_delete
  on conversation_thread_participants;
create policy conversation_thread_participants_orchestrator_namespace_delete
  on conversation_thread_participants as restrictive for delete to public
  using (
    app_is_system()
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists conversation_messages_orchestrator_namespace_insert
  on conversation_messages;
create policy conversation_messages_orchestrator_namespace_insert
  on conversation_messages as restrictive for insert to public
  with check (
    app_is_system()
    or (
      idempotency_key !~ '^orchestrator:'
      and adapter_key <> 'orchestrator-mock'
      and not is_internal_conversation_identity(tenant_id, channel_identity_id)
    )
  );

drop policy if exists conversation_messages_orchestrator_namespace_update
  on conversation_messages;
create policy conversation_messages_orchestrator_namespace_update
  on conversation_messages as restrictive for update to public
  using (
    app_is_system()
    or (
      idempotency_key !~ '^orchestrator:'
      and adapter_key <> 'orchestrator-mock'
      and channel_identity_id !~ '^orchestrator_identity_'
    )
  )
  with check (
    app_is_system()
    or (
      idempotency_key !~ '^orchestrator:'
      and adapter_key <> 'orchestrator-mock'
      and channel_identity_id !~ '^orchestrator_identity_'
    )
  );

drop policy if exists conversation_messages_orchestrator_namespace_delete
  on conversation_messages;
create policy conversation_messages_orchestrator_namespace_delete
  on conversation_messages as restrictive for delete to public
  using (
    app_is_system()
    or (
      idempotency_key !~ '^orchestrator:'
      and adapter_key <> 'orchestrator-mock'
      and channel_identity_id !~ '^orchestrator_identity_'
    )
  );

drop policy if exists conversation_message_attachments_orchestrator_namespace_insert
  on conversation_message_attachments;
create policy conversation_message_attachments_orchestrator_namespace_insert
  on conversation_message_attachments as restrictive for insert to public
  with check (
    app_is_system()
    or not is_internal_conversation_message(
      tenant_id,
      message_id
    )
  );

drop policy if exists conversation_message_attachments_orchestrator_namespace_update
  on conversation_message_attachments;
create policy conversation_message_attachments_orchestrator_namespace_update
  on conversation_message_attachments as restrictive for update to public
  using (
    app_is_system()
    or not is_internal_conversation_message(
      tenant_id,
      message_id
    )
  )
  with check (
    app_is_system()
    or not is_internal_conversation_message(
      tenant_id,
      message_id
    )
  );

drop policy if exists conversation_message_attachments_orchestrator_namespace_delete
  on conversation_message_attachments;
create policy conversation_message_attachments_orchestrator_namespace_delete
  on conversation_message_attachments as restrictive for delete to public
  using (
    app_is_system()
    or not is_internal_conversation_message(
      tenant_id,
      message_id
    )
  );

drop policy if exists conversation_message_route_hops_orchestrator_namespace_insert
  on conversation_message_route_hops;
create policy conversation_message_route_hops_orchestrator_namespace_insert
  on conversation_message_route_hops as restrictive for insert to public
  with check (
    app_is_system()
    or (
      adapter_key <> 'orchestrator-mock'
      and not is_internal_conversation_identity(tenant_id, channel_identity_id)
      and not is_internal_conversation_message(
        tenant_id,
        message_id
      )
    )
  );

drop policy if exists conversation_message_route_hops_orchestrator_namespace_update
  on conversation_message_route_hops;
create policy conversation_message_route_hops_orchestrator_namespace_update
  on conversation_message_route_hops as restrictive for update to public
  using (
    app_is_system()
    or (
      adapter_key <> 'orchestrator-mock'
      and not is_internal_conversation_identity(tenant_id, channel_identity_id)
      and not is_internal_conversation_message(
        tenant_id,
        message_id
      )
    )
  )
  with check (
    app_is_system()
    or (
      adapter_key <> 'orchestrator-mock'
      and not is_internal_conversation_identity(tenant_id, channel_identity_id)
      and not is_internal_conversation_message(
        tenant_id,
        message_id
      )
    )
  );

drop policy if exists conversation_message_route_hops_orchestrator_namespace_delete
  on conversation_message_route_hops;
create policy conversation_message_route_hops_orchestrator_namespace_delete
  on conversation_message_route_hops as restrictive for delete to public
  using (
    app_is_system()
    or (
      adapter_key <> 'orchestrator-mock'
      and not is_internal_conversation_identity(tenant_id, channel_identity_id)
      and not is_internal_conversation_message(
        tenant_id,
        message_id
      )
    )
  );

drop policy if exists channel_provider_deliveries_internal_conversation_insert
  on channel_provider_deliveries;
create policy channel_provider_deliveries_internal_conversation_insert
  on channel_provider_deliveries as restrictive for insert to public
  with check (
    app_is_system()
    or (
      not is_internal_conversation_message(tenant_id, message_id)
      and not is_internal_conversation_identity(
        tenant_id,
        channel_identity_id
      )
    )
  );

drop policy if exists channel_provider_deliveries_internal_conversation_update
  on channel_provider_deliveries;
create policy channel_provider_deliveries_internal_conversation_update
  on channel_provider_deliveries as restrictive for update to public
  using (
    app_is_system()
    or (
      not is_internal_conversation_message(tenant_id, message_id)
      and not is_internal_conversation_identity(
        tenant_id,
        channel_identity_id
      )
    )
  )
  with check (
    app_is_system()
    or (
      not is_internal_conversation_message(tenant_id, message_id)
      and not is_internal_conversation_identity(
        tenant_id,
        channel_identity_id
      )
    )
  );

drop policy if exists channel_provider_deliveries_internal_conversation_delete
  on channel_provider_deliveries;
create policy channel_provider_deliveries_internal_conversation_delete
  on channel_provider_deliveries as restrictive for delete to public
  using (
    app_is_system()
    or (
      not is_internal_conversation_message(tenant_id, message_id)
      and not is_internal_conversation_identity(
        tenant_id,
        channel_identity_id
      )
    )
  );

drop policy if exists channel_provider_secret_versions_internal_identity_insert
  on channel_provider_secret_versions;
create policy channel_provider_secret_versions_internal_identity_insert
  on channel_provider_secret_versions as restrictive for insert to public
  with check (
    app_is_system()
    or channel_identity_id is null
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists channel_provider_secret_versions_internal_identity_update
  on channel_provider_secret_versions;
create policy channel_provider_secret_versions_internal_identity_update
  on channel_provider_secret_versions as restrictive for update to public
  using (
    app_is_system()
    or channel_identity_id is null
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  )
  with check (
    app_is_system()
    or channel_identity_id is null
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists channel_provider_secret_versions_internal_identity_delete
  on channel_provider_secret_versions;
create policy channel_provider_secret_versions_internal_identity_delete
  on channel_provider_secret_versions as restrictive for delete to public
  using (
    app_is_system()
    or channel_identity_id is null
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists channel_provider_identity_bindings_internal_identity_insert
  on channel_provider_identity_bindings;
create policy channel_provider_identity_bindings_internal_identity_insert
  on channel_provider_identity_bindings as restrictive for insert to public
  with check (
    app_is_system()
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists channel_provider_identity_bindings_internal_identity_update
  on channel_provider_identity_bindings;
create policy channel_provider_identity_bindings_internal_identity_update
  on channel_provider_identity_bindings as restrictive for update to public
  using (
    app_is_system()
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  )
  with check (
    app_is_system()
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists channel_provider_identity_bindings_internal_identity_delete
  on channel_provider_identity_bindings;
create policy channel_provider_identity_bindings_internal_identity_delete
  on channel_provider_identity_bindings as restrictive for delete to public
  using (
    app_is_system()
    or not is_internal_conversation_identity(tenant_id, channel_identity_id)
  );

drop policy if exists channel_provider_media_imports_internal_message_insert
  on channel_provider_media_imports;
create policy channel_provider_media_imports_internal_message_insert
  on channel_provider_media_imports as restrictive for insert to public
  with check (
    app_is_system()
    or not is_internal_conversation_message(tenant_id, message_id)
  );

drop policy if exists channel_provider_media_imports_internal_message_update
  on channel_provider_media_imports;
create policy channel_provider_media_imports_internal_message_update
  on channel_provider_media_imports as restrictive for update to public
  using (
    app_is_system()
    or not is_internal_conversation_message(tenant_id, message_id)
  )
  with check (
    app_is_system()
    or not is_internal_conversation_message(tenant_id, message_id)
  );

drop policy if exists channel_provider_media_imports_internal_message_delete
  on channel_provider_media_imports;
create policy channel_provider_media_imports_internal_message_delete
  on channel_provider_media_imports as restrictive for delete to public
  using (
    app_is_system()
    or not is_internal_conversation_message(tenant_id, message_id)
  );
