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
- liaison domaine-site limitée au fournisseur mock local et à une version déjà publiée;
- carte de connexion limitée à 31 nœuds observés; aucun moteur de graphe général;
- estimations de valeur qualitatives seulement; aucun gain financier ou temporel sans mesure validée;
- aucune dépendance Internet dans les tests.

Les résultats du fournisseur DNS mock prouvent le flux de contrôle, pas la disponibilité d'un fournisseur externe. Les instructions manuelles sont génériques tant que l'interface officielle du fournisseur n'est pas vérifiée.

La liaison mock est limitée aux domaines réservés en `.test` et ne configure ni routage public, ni certificat externe, ni fournisseur DNS. Son état `available` signifie seulement que la fixture locale a vérifié la cible approuvée. Le brouillon du site reste séparé du snapshot public et une déconnexion ne retire aucun enregistrement réel.

Le résultat d'exécution du connecteur mock prouve le policy engine, l'idempotence, le quota, la santé et la révocation. Il ne constitue ni un test sandbox officiel ni une preuve de compatibilité avec un fournisseur réel.
