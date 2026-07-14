# Phase 5 - Connectivité réelle et contrôlée

Statut: en cours sur `codex/phase-5-real-connectivity`.

## Objectif

Permettre à une organisation de préparer et superviser ses connexions externes sans confondre recommandation, simulation, sandbox et production.

## Premier checkpoint livré

- analyse DNS mock déterministe et sans réseau;
- configuration manuelle clairement marquée comme non vérifiée;
- preuves avec source, confiance, date et statut;
- instantanés DNS et plans de changement tenant-scoped;
- blocage des suppressions, changements MX, remplacement SPF, affaiblissement DMARC et changement de serveurs de noms;
- double confirmation et revalidation de l'état courant;
- simulation sans effet DNS externe;
- audit, transactions, clés tenant-composées, index et RLS.

## Prochaine tranche

L'interface domaine, OAuth mock, l'installation logicielle contrôlée, la lecture seule, la santé et la déconnexion doivent être terminés avant toute intégration réelle.

## Frontière de sécurité

Aucune écriture de production, modification DNS réelle, activation automatique de connecteur ou utilisation libre d'Internet n'est disponible.
