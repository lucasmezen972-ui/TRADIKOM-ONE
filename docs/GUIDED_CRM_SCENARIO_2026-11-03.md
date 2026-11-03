# Scénario guidé : demande, proposition et tâche CRM

Le parcours ajoute une proposition durable dans le fil, avant toute création de tâche. Le contact, le titre et l’échéance sont figés. Seul le préparateur encore autorisé peut confirmer la visibilité équipe ou refuser ; le refus est terminal. Une confirmation rejouée renvoie la même tâche et le même rapport. La création, le rapport et l’audit sont atomiques. La proposition suit la RLS du fil privé.

Le scénario est guidé, sans appel modèle ni message externe. Les plans de l’orchestrateur restent mock. Les budgets IA restent nuls.

Validation initiale : 10 tests ciblés réussis (propositions, tâche native et miroirs SQL), dont rôle limité, confidentialité du fil et nettoyage du contexte. Les 6 tests propositions passent aussi avec PostgreSQL17.5 embarqué. Lint et TypeScript passent. Build webpack réussi avec configuration locale factice ; deux recettes Playwright mobiles390×844 réussies (création confirmée et refus terminal) : proposition persistante, absence de tâche avant confirmation, création réelle, rapport et tâche retrouvés après rechargement ; refus persistant et aucune tâche associée. Suite complète :1116 réussis,37 ignorés, zéro échec ;180 fichiers verts/16 ignorés sur196,1740,65secondes. Les tests PostgreSQL distants ignorés restent non prouvés. Aucune recette hébergée nouvelle revendiquée.

Migrations candidates :133_conversation_task_proposals et134_conversation_task_proposals_rls ; miroirs0127/0128. Elles ajoutent une table et deux index de référence tenant-composés. La base hébergée reste132 à ce checkpoint ; ne pas déployer le candidat avant application native confirmée et vérifiée. Préversion actuelle a0920cf conservée. Le compte personnel de Lucas et son entreprise doivent rester intacts.

La confirmation native apply_migration a expiré après deux minutes, sans application. Une requête distincte confirme journal132 et absence de la nouvelle table. Aucun contournement et aucun déploiement du candidat. La prochaine reprise doit terminer la suite complète puis obtenir une confirmation native valable avant de publier et tester cette fonctionnalité hébergée.
