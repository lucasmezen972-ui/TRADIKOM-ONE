# Centre de pilotage

La page `Aujourd'hui` répond à quatre questions : que faire aujourd'hui, qu'est-ce qui bloque, où sont les opportunités, et quelles actions attendent une validation.

Toutes les valeurs viennent de lectures SQL tenant-scoped. Chaque indicateur ouvre une vue filtrée par le même critère métier que le compteur, afin qu'un chiffre et la liste correspondante ne divergent jamais.

## Indicateurs et vues filtrées

| Indicateur | Vue ouverte | Critère |
| --- | --- | --- |
| Nouveaux leads | `/contacts?vue=nouveaux-leads` | leads créés dans le jour métier courant |
| Tâches en retard | `/contacts?vue=taches-en-retard` | tâches `open` dont l'échéance est dépassée |
| Opportunités à relancer | `/opportunites?filtre=relance` | étape ouverte, `next_follow_up_at` échu avant la fin du jour métier |
| Opportunités bloquées | `/opportunites?filtre=bloquees` | étape ouverte, sans avancée depuis 7 jours |
| Incidents actifs | `/automatisations?filtre=echecs` | exécutions de workflow en échec terminal |

Le jour métier est calculé dans le fuseau de l'organisation (`BUSINESS_TIME_ZONE`, par défaut `America/Martinique`) par `src/lib/business-day.ts`, et non en UTC : un lead reçu à 22 h aux Antilles reste un lead du jour.

## Opportunité bloquée

Une opportunité est bloquée quand elle réunit les trois conditions suivantes :

- son étape de pipeline n'est pas terminale (ni gagné, ni perdu) ;
- elle n'a pas été modifiée depuis plus de 7 jours ;
- elle n'a aucune prochaine action planifiée, **ou** sa relance planifiée est dépassée depuis plus de 7 jours.

La troisième condition compte les deux cas parce que le workflow de lead planifie systématiquement une relance à J+1 : une définition limitée à `next_follow_up_at is null` ne se déclencherait presque jamais en production.

Le seuil et la liste des étapes terminales sont centralisés dans `src/lib/pipeline-stages.ts`, partagés par le module `dashboard` et le module `crm` pour que le compteur du tableau de bord et la vue filtrée du pipeline appliquent exactement la même règle.

« Bloquée » se distingue de « à relancer » : la relance est l'action normale du jour, le blocage signale une vente qui n'avance plus.

Les deux compteurs d'opportunités sont calculés depuis une CTE `open_opportunities` commune, pour ne parcourir la table qu'une fois par chargement du tableau de bord.

## Limites actuelles

- Le seuil de 7 jours est une constante, pas encore un réglage par organisation.
- Les étapes terminales sont reconnues par nom (`gagne`, `gagné`, `perdu`, `won`, `lost`) ; un pipeline personnalisé avec d'autres libellés de clôture ne sera pas exclu.
- Les listes du centre de pilotage restent bornées à dix éléments ; les compteurs, eux, sont exacts.
