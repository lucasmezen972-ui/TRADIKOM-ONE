# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Faire valider les schémas de plan, le catalogue des deux capacités mock et les migrations runtime `069`/`070` avec leurs miroirs `0063`/`0064`. Ajouter ensuite le repository et le service tenant-aware qui créent un plan immuable et une seule approbation liée au plan exact.

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
6. Plan structuré, validation unique et deux capacités mock explicites. Schémas et persistance locaux, service à faire après CI.
7. Playwright web + canal test, reprise et preuve d'audit.

Ne pas ouvrir OS-2 tant que ce parcours n'est pas vert de bout en bout.
