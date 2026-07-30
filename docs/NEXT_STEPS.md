# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Faire valider par CI l'affichage exact du plan et les commandes françaises Approuver/Refuser sur l'écran Conversation. Enchaîner avec l'exécution durable des deux capacités mock et projeter le résultat dans le fil canonique.

## Bloc de reprise exact

Le service de plan est publié dans `1dca742`. Aucun secret, déploiement, merge ou dépense n'est requis pour la suite locale et la CI de la PR brouillon.

```text
1. Valider le service de plan sur le run 30552219390.
2. Publier l'interface de plan et décision unique avec ses tests tenant-aware.
3. Suivre la CI de la PR #11 jusqu'à migrations, lint, typecheck, tests, build et Playwright.
4. Implémenter l'exécution mock durable sur le moteur existant, avec idempotence et reprise.
5. Projeter résultat et preuve d'audit dans le fil canonique et les deux canaux.
6. Ajouter le parcours Playwright desktop et mobile, puis ne corriger que les causes observées.
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
6. Plan structuré, validation unique et deux capacités mock explicites. Repository/service publiés; interface et CI finale en cours.
7. Playwright web + canal test, reprise et preuve d'audit.

Ne pas ouvrir OS-2 tant que ce parcours n'est pas vert de bout en bout.
