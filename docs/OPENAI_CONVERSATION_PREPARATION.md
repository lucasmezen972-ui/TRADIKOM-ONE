# Générateur Conversation OpenAI préparé

L'adaptateur `src/modules/orchestrator/openai-generator.ts` est autonome et n'est ni exporté par le barrel, ni sélectionné par le runtime. Le générateur courant reste déterministe. Ce code ne prouve aucune connexion fournisseur.

## Frontière d'activation

La fabrique exige une configuration explicite, un modèle nommé, une borne de sortie, et deux implémentations serveur :

1. `authorizeAndReserve` doit retrouver l'acteur authentifié, vérifier ses accès au tenant, au fil et au message exact, consommer un consentement de transfert à usage unique et réserver durablement le budget. Les sources externes nécessitent un consentement distinct.
2. `recordOutcome` doit enregistrer les preuves sûres et réconcilier cette réservation. Une impossibilité d'enregistrer la preuve empêche le retour du plan.

Un flag, une clé, un objet venant du navigateur ou un callback factice ne remplacent jamais ces contrôles. Sans cette frontière, la génération retourne `model_not_configured` sans appel réseau. Le raccord au runtime reste une étape ultérieure soumise à tests.

## Transport et sortie

Le SDK OpenAI déjà présent est utilisé sur l'origine fixe `https://api.openai.com/v1`, avec 20 secondes de timeout, aucun retry, aucune redirection et aucun log SDK. La requête demande une sortie JSON Schema stricte et `store:false`. Ce paramètre ne constitue pas à lui seul une garantie d'absence totale de rétention.

Le modèle peut proposer seulement une clarification ou une recherche de contact suivie d'une tâche mock. Le serveur construit les capacités, risques, validations, réversibilité et clés d'idempotence. Les inputs sont bornés à 200 caractères et passent les schémas réels du manifeste. La sortie repasse la validation ActionPlan et la garde anti-recopie des sources externes.

Le coût nul du plan concerne uniquement les actions mock. La génération par modèle peut être payante et sa réservation/consommation doit être présentée et auditée séparément, avant tout appel.

## Preuves et limites

Les scénarios préparés dans `tests/openai-action-plan-generator.test.ts` couvrent configuration absente, autorisations fausses/expirées, consentement de contexte externe, JSON invalide, bornes 200/201, refus fournisseur, non-recopie et audit indisponible. Vingt callbacks ont été exécutés dans un banc en mémoire avec transport double, matchers adaptés et Zod embarqué Next.js. Lint et analyse syntaxique sont verts.

La suite native du dépôt, le typecheck complet, le SDK réel, le réseau fournisseur et PostgreSQL n'ont pas été exécutés sur ce lot. Aucun fournisseur n'est activé et aucune clé réelle n'est demandée dans le chat.

## Sources officielles consultées

- [Sorties structurées](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Options du SDK 6.46.0](https://github.com/openai/openai-node/blob/v6.46.0/src/client.ts)
- [Types de requêtes et réponses](https://github.com/openai/openai-node/blob/v6.46.0/src/resources/responses/responses.ts)
- [Contrôles des données](https://developers.openai.com/api/docs/guides/your-data)
