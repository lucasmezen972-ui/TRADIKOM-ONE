# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Faire valider en CI la migration runtime `067`/`068` et ses miroirs SQL `0061`/`0062`. Ajouter ensuite `src/modules/conversation-hub/repository.ts` et un service tenant-aware : vérifier le membership côté serveur, ingérer un message dans une transaction idempotente, relire un fil ordonné et auditer uniquement les identifiants et statuts sûrs.

## Critères du prochain checkpoint

- membership obligatoire avant lecture ou mutation;
- toutes les requêtes incluent `tenant_id`;
- replay de la même clé d'idempotence sans doublon;
- relation inter-tenant refusée même avec un identifiant valide;
- fil relu dans un ordre déterministe et borné;
- audit sans texte de message, payload brut, secret, binaire ni URL signée;
- aucun nom de fournisseur ou appel externe dans le coeur;
- état de reprise mis à jour avant l'arrêt.

## Ordre

1. Contrats et tests du Conversation Hub. Terminé localement.
2. Migration additive, relations tenant-composées, index tenant-leading et RLS. Implémentée, validation CI en attente.
3. Repository et service tenant-aware. Prochain checkpoint après CI verte.
4. Adaptateur canal de test et web chat minimal.
5. Plan structuré, validation unique et deux capacités mock explicites.
6. Playwright web + canal test, reprise et preuve d'audit.

Ne pas ouvrir OS-2 tant que ce parcours n'est pas vert de bout en bout.
