-- Fixed trusted lookup path. pg_temp is explicitly last to prevent relation shadowing.
DO $$
DECLARE signature text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'app_current_tenant_id()',
    'app_enforce_api_change_event_integrity()',
    'app_enforce_api_change_impact_product()',
    'app_enforce_connector_repair_integrity()',
    'app_enforce_related_tenant()',
    'app_is_system()',
    'enforce_channel_provider_activation_budget()',
    'enforce_channel_provider_media_import_external_extraction()',
    'enforce_channel_provider_media_import_scan_success()',
    'enforce_conversation_action_plan_immutability()',
    'enforce_conversation_action_plan_policy_receipt_binding()',
    'enforce_conversation_action_plan_step_immutability()',
    'enforce_meta_delivery_activation_authorization()',
    'protect_channel_delivery_activation_authorization()',
    'protect_channel_provider_activation_authorization()',
    'protect_channel_provider_endpoint_identity()',
    'protect_channel_provider_identity_binding()',
    'protect_channel_provider_media_import_execution_identity()',
    'protect_channel_provider_secret_version()',
    'protect_conversation_attachment_external_extraction()',
    'protect_workflow_run_definition_snapshot()',
    'reject_channel_provider_activation_consumption_update()',
    'reject_channel_provider_delivery_event_update()',
    'reject_channel_provider_media_import_update()',
    'reject_conversation_action_plan_policy_receipt_mutation()',
    'reject_email_provider_event_update()'
  ] LOOP
    IF to_regprocedure('public.' || signature) IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION public.%s SET search_path = pg_catalog, public, pg_temp', signature);
    END IF;
  END LOOP;
END
$$;
