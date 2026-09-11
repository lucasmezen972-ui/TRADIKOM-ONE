# ADR 0001 - Transition vers un OS conversationnel

- Statut : accepté
- Date : 2026-07-29

## Contexte

Le dépôt possède un socle multi-tenant, des workflows durables, des approvals, un audit, des connecteurs bornés et de nombreux modules de planification. Il ne possède pas encore de modèle canonique de conversation ni d'identité omnicanale. Continuer à enrichir les écrans CRM augmenterait la surface sans prouver la promesse centrale.

## Décision

Construire les nouvelles tranches dans des modules bornés sous `src/modules/` : `conversation-hub`, `omnichannel-identity`, puis `capability-catalog`. Le coeur ne connaît aucun fournisseur. Les adaptateurs traduisent leurs formats vers des messages, identités, capacités, plans, validations, preuves et résultats canoniques.

Le système réutilise les transactions tenant, PostgreSQL/RLS, l'audit, les approvals, les événements durables et le Connector Runtime existants. Aucune seconde file, seconde politique ou seconde piste d'audit n'est créée.

## Conséquences

- OS-1 est test-first et vertical : web + canal test avant les fournisseurs réels.
- Les noms WhatsApp, Slack, Teams, Resend ou HubSpot restent dans les adaptateurs.
- Une sortie IA ne devient jamais une commande; elle doit produire un plan structuré validé par schéma, politique et humain selon le risque.
- La PR #10 est découpée par capacité avant réutilisation; ses lots CRM ne bloquent pas OS-1.
- Les anciennes documentations Phase 2 à 5 restent historiques. `AGENT_STATE.json` et la roadmap OS deviennent la source de reprise courante.
