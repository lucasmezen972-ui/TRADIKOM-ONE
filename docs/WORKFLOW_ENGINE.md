# Workflow Engine

Le moteur MVP est evenementiel et synchrone pour la demo locale.

Declencheurs prepares : `form.submitted`, `contact.created`, `lead.created`, `opportunity.stage_changed`, `website.published`, `connector.sync_completed`.

Actions preparees : `create_task`, `update_contact`, `add_tag`, `create_activity`, `send_mock_email`, `send_mock_sms`, `send_mock_whatsapp`, `call_webhook`, `wait`.

Workflow actif : quand un lead site est cree, creer une tache de relance pour le proprietaire et envoyer une notification mock.

Les tables `workflow_runs`, `workflow_run_steps`, `approvals` et `retry_count` preparent les delais, erreurs, retries et gates d'approbation.
