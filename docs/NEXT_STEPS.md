# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Créer `src/modules/conversation-hub/schemas.ts` avec les contrats Zod du fil canonique, du message canonique, de l'identité de canal, de l'idempotence et de la corrélation. Ajouter d'abord les tests de validation, puis seulement la migration tenant-scoped.

## Critères du prochain checkpoint

- aucun nom de fournisseur dans le coeur du domaine;
- interface et erreurs visibles en français;
- tenant et membership vérifiés côté service;
- idempotence d'entrée et anti-boucle testées;
- messages, pièces jointes et statuts bornés;
- aucun secret, payload brut ou contenu client dans les audits;
- aucune exécution externe depuis une sortie IA;
- état de reprise mis à jour avant l'arrêt.

## Ordre

1. Contrats et tests du Conversation Hub.
2. Migration additive, relations tenant-composées, index tenant-leading et RLS.
3. Repository et service tenant-aware.
4. Adaptateur canal de test et web chat minimal.
5. Plan structuré, validation unique et deux capacités mock explicites.
6. Playwright web + canal test, reprise et preuve d'audit.

Ne pas ouvrir OS-2 tant que ce parcours n'est pas vert de bout en bout.
