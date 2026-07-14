# Plateforme de connexion de domaine

## Modèle

Les connexions, instantanés, plans et approbations sont stockés dans `domain_connections`, `dns_snapshots`, `dns_change_plans` et `dns_change_approvals`. Chaque relation contient `tenant_id`, utilise une clé étrangère tenant-composée et est protégée par RLS.

## Adaptateurs initiaux

- `mock_dns`: fixture locale, capacités déclarées, simulation sans réseau;
- `manual`: guide personnalisé à partir du plan, aucune interface fournisseur inventée.

Les adaptateurs exposent explicitement lecture, création, mise à jour, suppression, serveurs de noms, propagation, OAuth, clé API et sandbox.

## Contrôle d'un plan

Un plan part du dernier instantané, expire après 24 heures et contient les changements, impacts, risques courrier/site, état de retour arrière et vérifications. Une approbation initiale puis une seconde confirmation sont obligatoires. La confirmation échoue si un nouvel instantané a remplacé l'état de référence.

## Limite actuelle

La simulation valide le plan et génère les instructions manuelles. Elle n'envoie aucune commande à un fournisseur DNS.
