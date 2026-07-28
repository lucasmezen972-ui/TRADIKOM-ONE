# Backlog Phase 0 / Phase 1

## Termine dans ce MVP

- Bootstrap Next.js App Router avec TypeScript et Tailwind.
- Auth email/mot de passe avec hash scrypt et sessions HTTP-only.
- Organisations, memberships, roles et switch tenant.
- Onboarding Business Twin avec sauvegarde structuree.
- Website Factory schema-driven avec sections editables, versions et publication locale.
- Site public `/sites/{tenant-slug}` avec formulaire.
- Creation automatique contact, lead, opportunite, activite, tache et notification mock.
- Dashboard, CRM, workflows, connecteurs, import CSV, webhook et audit log.
- Reset password securise, invitations d'equipe et administration des roles non-owner.
- Seed Garage Caraibes Auto.

## Prochaines priorites

- Brancher un fournisseur email de production pour reset password et invitations.
- Ajouter file upload valide pour logo/photos.
- Ajouter connecteurs OAuth reels.
- Brancher les vrais appels OpenAI structures derriere l'abstraction.
- Remplacer les actions email/SMS/WhatsApp mock par des fournisseurs approuves.
- Ajouter exports de donnees. La suppression de compte est livree (`src/modules/account-deletion`).
- Rendre configurable par organisation le seuil d'opportunite bloquee, fixe a 7 jours (`docs/COMMAND_CENTER.md`).
- Ajouter le glisser-deposer entre etapes du pipeline (`docs/PIPELINE.md`).
- Permettre de modifier une proposition depuis le centre d'approbation (`docs/APPROVAL_CENTER.md`).
