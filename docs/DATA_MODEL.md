# Data Model

Tables principales :

- Identite : `users`, `sessions`, `password_reset_tokens`
- Tenancy : `tenants`, `memberships`, `invitations`
- Business Twin : `business_profiles`, `knowledge_documents`
- CRM : `contacts`, `companies`, `contact_consents`, `pipelines`, `pipeline_stages`, `opportunities`, `leads`, `activities`, `notes`, `tasks`
- Site : `websites`, `website_pages`, `website_sections`, `website_versions`, `website_publications`, `forms`, `form_fields`, `form_submissions`
- Workflows : `workflows`, `workflow_runs`, `workflow_run_steps`, `approvals`
- Connecteurs : `connectors`, `connector_accounts`, `connector_credentials`, `connector_sync_runs`, `webhook_endpoints`, `webhook_deliveries`, `external_record_mappings`, `imports`, `import_rows`
- Observabilite : `notifications`, `audit_logs`
- Phase 2 : `domain_events`, `rate_limits`, `generation_records`, `connector_secret_versions`

Toutes les donnees metier portent `tenant_id`. Les services verifient le membership avant lecture/ecriture et toutes les requetes metier filtrent par tenant.

Phase 2 ajoute les colonnes `current_draft_version_id`, `current_published_version_id` et `version_type` pour separer les brouillons des publications immuables.
