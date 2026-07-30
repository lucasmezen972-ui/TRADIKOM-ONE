# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Publier et faire valider le parcours Playwright Conversation complet sur desktop et mobile. En cas de vert, produire le rapport final OS-1; en cas de rouge, corriger uniquement le diagnostic observé.

## Référence prompt maître

Les pages 31, 46 et 48 imposent de terminer la première verticale avant toute extension : validation unique, exécution des deux capacités mock, résultat répliqué, audit et reprise. Les pages 32 et 69 exigent les preuves unitaires, intégration, PostgreSQL/RLS, workflow, provider non configuré, sécurité, Playwright mobile/desktop et accessibilité. La page 71 conserve le critère suprême : obtenir un résultat métier plus simplement par la conversation.

## Bloc de reprise exact

Le service, l'interface et l'exécution durable sont publiés jusqu'à `84d064c`. Le typecheck de ce head est vert et les tests complets tournent. Le scénario Playwright desktop/mobile est prêt localement.

```text
1. Publier le parcours Conversation message web -> canal test -> plan -> approbation -> exécution -> résultat.
2. Suivre la CI jusqu'à migrations, lint, typecheck, tests, build et Playwright.
3. Vérifier son exécution aux largeurs desktop et mobile et ses commandes clavier.
4. Vérifier les preuves SQL : un run, deux étapes, deux routes, un audit, aucune tâche réelle.
5. Corriger uniquement les causes observées.
6. Produire le rapport OS-1 contre la Definition of Done page 32 et la matrice page 69.
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
