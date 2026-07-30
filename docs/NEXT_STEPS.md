# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Publier et faire valider l'exécution durable des deux capacités mock et le résultat routé vers le web et le canal de test. Enchaîner avec le parcours Playwright Conversation complet sur desktop et mobile.

## Référence prompt maître

Les pages 31, 46 et 48 imposent de terminer la première verticale avant toute extension : validation unique, exécution des deux capacités mock, résultat répliqué, audit et reprise. Les pages 32 et 69 exigent les preuves unitaires, intégration, PostgreSQL/RLS, workflow, provider non configuré, sécurité, Playwright mobile/desktop et accessibilité. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Le service de plan est publié dans `1dca742` et l'interface dans `ffe258e`. L'exécution durable est prête localement avec un test d'intégration. Aucun secret, déploiement, merge ou dépense n'est requis.

```text
1. Publier le workflow durable mock, la correction du test de tables et le renforcement de l'automation PDF.
2. Suivre la CI de la PR #11 jusqu'à migrations, lint, typecheck, tests, build et Playwright.
3. Ajouter le parcours Conversation message web -> canal test -> plan -> approbation -> exécution -> résultat.
4. Exécuter ce parcours aux largeurs desktop et mobile et vérifier le clavier.
5. Vérifier les preuves audit, idempotence, routage et absence d'effet externe en base.
6. Corriger uniquement les causes observées puis produire le rapport OS-1.
```

## Critères du prochain checkpoint

- le plan conserve source, version, fingerprint et état d'approbation;
- chaque capacité est générique, mock explicite, bornée et validée par son schéma;
- aucun secret, credential, payload brut ou texte LLM direct n'est persistant;
- un plan incomplet, payant, sans scope ou altérant la politique est refusé;
- une seule ligne d'approbation peut cibler un plan exact;
- plan et étapes restent immuables hors transitions d'état autorisées;
- RLS, relations tenant-composées et index tenant-leading couvrent les nouvelles tables;
- état de reprise mis à jour avant l'arrêt.

## Ordre

1. Contrats et tests du Conversation Hub. Terminé localement.
2. Migration additive, relations tenant-composées, index tenant-leading et RLS. Terminée et validée par la CI.
3. Repository et service tenant-aware. Terminé et validé.
4. Adaptateur canal de test. Terminé et validé sans transport réseau.
5. Web chat minimal. Terminé et validé par le run `30549936954`.
6. Plan structuré, validation unique et deux capacités mock explicites. Interface publiée; exécution durable prête à valider.
7. Playwright web + canal test, reprise et preuve d'audit. Prochaine étape active.

Ne pas ouvrir OS-2 tant que ce parcours n'est pas vert de bout en bout.
