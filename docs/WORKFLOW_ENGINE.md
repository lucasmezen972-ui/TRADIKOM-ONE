# Workflow Engine

Le moteur est evenementiel et durable. Les executions, etapes, reprises, approbations et evenements de livraison sont persistes avant traitement par le worker.

Declencheurs prepares : `form.submitted`, `contact.created`, `lead.created`, `opportunity.stage_changed`, `website.published`, `connector.sync_completed`.

Actions disponibles : `create_task`, `update_contact`, `add_tag`, `create_activity`, `send_mock_email`, `send_mock_sms`, `send_mock_whatsapp`, `call_webhook`, `wait_for_duration`, `request_approval`.

`call_webhook` cree un evenement `workflow.webhook_requested` idempotent. Le worker effectue un POST HTTPS avec retry/backoff, timeout, refus des redirections et des cibles locales/privees, resolution DNS publique complete, connexion epinglee sur l'adresse validee, limites de charge utile et audit de succes.

Workflow actif : quand un lead site est cree, creer une tache de relance pour le proprietaire et envoyer une notification mock.

Les tables `workflow_runs`, `workflow_run_steps`, `approvals` et `domain_events` portent les delais, erreurs, tentatives, reprises et gates d'approbation.
