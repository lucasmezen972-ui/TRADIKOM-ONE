# Limites Phase 5

État du premier checkpoint:

- aucune modification DNS réelle;
- aucun fournisseur DNS réel;
- aucun OAuth réel; seul le fournisseur mock local est connecté à l'interface;
- une seule installation mock en lecture seule, sans réseau ni donnée client;
- aucune lecture production;
- aucune écriture production;
- imports limités à 5 Mo et 10 000 lignes;
- exports limités à 10 Mo, 5 000 lignes et 366 jours;
- fichiers d'export conservés dans un stockage borné tenant-owned et supprimés après 24 heures; aucun stockage objet externe;
- aucune liaison domaine-site active;
- aucune dépendance Internet dans les tests.

Les résultats du fournisseur DNS mock prouvent le flux de contrôle, pas la disponibilité d'un fournisseur externe. Les instructions manuelles sont génériques tant que l'interface officielle du fournisseur n'est pas vérifiée.

Le résultat d'exécution du connecteur mock prouve le policy engine, l'idempotence, le quota, la santé et la révocation. Il ne constitue ni un test sandbox officiel ni une preuve de compatibilité avec un fournisseur réel.
