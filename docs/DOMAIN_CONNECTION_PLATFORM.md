# Plateforme de connexion de domaine

## Modèle

Les connexions, instantanés, plans, approbations, liaisons de site et vérifications durables sont stockés dans `domain_connections`, `dns_snapshots`, `dns_change_plans`, `dns_change_approvals`, `website_domain_bindings` et `domain_verification_jobs`. Chaque relation contient `tenant_id`, utilise une clé étrangère tenant-composée et est protégée par RLS.

## Adaptateurs initiaux

- `mock_dns`: fixture locale limitée aux domaines réservés en `.test`, capacités déclarées, simulation sans réseau;
- `manual`: guide personnalisé à partir du plan, aucune interface fournisseur inventée.

Les adaptateurs exposent explicitement lecture, création, mise à jour, suppression, serveurs de noms, propagation, OAuth, clé API et sandbox.

## Contrôle d'un plan

Un plan part du dernier instantané, expire après 24 heures et contient les changements, impacts, risques courrier/site, état de retour arrière et vérifications. Une approbation initiale puis une seconde confirmation sont obligatoires. La confirmation échoue si un nouvel instantané a remplacé l'état de référence.

## Limite actuelle

La simulation valide le plan et génère les instructions manuelles. Elle n'envoie aucune commande à un fournisseur DNS.

Le fournisseur mock peut ensuite vérifier localement la cible CNAME planifiée et lier le domaine au site déjà publié. La liaison enregistre la version publiée présente au moment de la demande, passe par un événement durable et ne publie jamais le brouillon courant. La déconnexion conserve le site et les DNS intacts puis affiche les instructions de retour arrière manuel.

Le fournisseur manuel ne peut pas être présenté comme vérifié sans preuve de propagation fournie par une future intégration officielle.

## Interface

`/connexions/domaines` permet à un propriétaire ou administrateur d'analyser un domaine, consulter les preuves et enregistrements, préparer le plan, effectuer les deux confirmations, lancer une simulation, demander la vérification mock et déconnecter la liaison. Les autres membres disposent d'une lecture seule. Les erreurs restent sûres et aucune commande d'application DNS réelle n'est rendue.
