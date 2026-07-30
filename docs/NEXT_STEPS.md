# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Faire valider en CI `src/modules/conversation-hub/repository.ts`, le service tenant-aware et leurs tests. Ajouter ensuite un adaptateur `canal-test` sans réseau, une route publique bornée pour le web chat et une première interface française qui relit le fil canonique.

## Critères du prochain checkpoint

- le canal de test n'effectue aucun appel réseau et produit une provenance canonique;
- l'entrée publique est limitée en taille et protégée contre le rejeu;
- le tenant est résolu côté serveur, jamais accepté depuis une sélection client arbitraire;
- le web chat visible reste entièrement en français;
- le même fil est lisible après un message web puis un message du canal test;
- l'audit reste sans texte de message, payload brut, secret, binaire ni URL signée;
- les erreurs publiques sont sûres et n'exposent ni structure SQL ni identifiant interne sensible;
- état de reprise mis à jour avant l'arrêt.

## Ordre

1. Contrats et tests du Conversation Hub. Terminé localement.
2. Migration additive, relations tenant-composées, index tenant-leading et RLS. Terminée et validée par la CI.
3. Repository et service tenant-aware. Implémentés, validation CI à lancer.
4. Adaptateur canal de test et web chat minimal. Prochain checkpoint après CI verte.
5. Plan structuré, validation unique et deux capacités mock explicites.
6. Playwright web + canal test, reprise et preuve d'audit.

Ne pas ouvrir OS-2 tant que ce parcours n'est pas vert de bout en bout.
