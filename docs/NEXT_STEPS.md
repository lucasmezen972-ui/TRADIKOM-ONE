# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Publier le correctif de chronologie du fil, les adaptateurs `web-chat` et `canal-test`, le service de lecture bornée et l'écran Conversation authentifié. Attendre lint, typecheck, tests PostgreSQL, build et Playwright de base avant d'ouvrir le plan structuré.

## Critères du prochain checkpoint

- le canal de test n'effectue aucun appel réseau et produit une provenance canonique;
- l'entrée web authentifiée est limitée en taille et protégée contre le rejeu;
- le tenant est résolu côté serveur, jamais accepté depuis une sélection client arbitraire;
- le web chat visible reste entièrement en français;
- le même fil est lisible après un message web puis un message du canal test;
- l'audit reste sans texte de message, payload brut, secret, binaire ni URL signée;
- les erreurs publiques sont sûres et n'exposent ni structure SQL ni identifiant interne sensible;
- état de reprise mis à jour avant l'arrêt.

## Ordre

1. Contrats et tests du Conversation Hub. Terminé localement.
2. Migration additive, relations tenant-composées, index tenant-leading et RLS. Terminée et validée par la CI.
3. Repository et service tenant-aware. Publiés; correctif de date préparé après le run rouge `30548008916`.
4. Adaptateur canal de test. Implémenté localement sans transport réseau.
5. Web chat minimal. Implémenté localement, validation CI à lancer.
6. Plan structuré, validation unique et deux capacités mock explicites. Prochain checkpoint après CI verte.
7. Playwright web + canal test, reprise et preuve d'audit.

Ne pas ouvrir OS-2 tant que ce parcours n'est pas vert de bout en bout.
