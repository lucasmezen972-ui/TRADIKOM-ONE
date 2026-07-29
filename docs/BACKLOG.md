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
- Exports universels (8 entites, CSV/XLSX/JSON, selection de champs et fenetre de dates) et suppression de compte RGPD.
- Seuil d'opportunite bloquee reglable par organisation, entre 1 et 90 jours (`docs/COMMAND_CENTER.md`).
- Apprentissage des refus par le conseiller strategique : une regle refusee est mise en sourdine 30 jours (`docs/STRATEGIC_ADVISOR.md`).
- Modification d'une proposition marketing depuis le centre d'approbation (`docs/APPROVAL_CENTER.md`).
- Liste de suppression email alimentee par les echecs definitifs de livraison (`docs/EMAIL_PROVIDER.md`).
- Suppression d'un fichier envoye, refusee tant qu'il est utilise (`docs/ASSET_UPLOAD.md`).
- Seed Garage Caraibes Auto.

## Prochaines priorites

- Gerer les webhooks de bounce du fournisseur email pour capter les rebonds asynchrones ; la liste de suppression alimentee par les echecs a l'envoi est livree (`docs/EMAIL_PROVIDER.md`).
- Ajouter analyse antivirus et redimensionnement des fichiers envoyes ; la suppression est livree (`docs/ASSET_UPLOAD.md`).
- Etendre la revision depuis le centre d'approbation aux quatre autres familles de propositions (`docs/APPROVAL_CENTER.md`).
- Ajouter connecteurs OAuth reels.
- Brancher les vrais appels OpenAI structures derriere l'abstraction.
- Remplacer les actions email/SMS/WhatsApp mock par des fournisseurs approuves. Les messages WhatsApp prets a envoyer sont livres (`docs/WHATSAPP.md`) ; l'API WhatsApp Business reste hors perimetre.
- Permettre le reordonnancement des cartes a l'interieur d'une colonne du pipeline (`docs/PIPELINE.md`).
- Rendre configurable la duree de sourdine d'une regle refusee, fixee a 30 jours (`docs/STRATEGIC_ADVISOR.md`).
