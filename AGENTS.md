# AGENTS.md

## Conventions

- Toute interface visible par les clients et utilisateurs reste en francais.
- Les modules metier vivent dans `src/lib`; les routes Next.js restent fines.
- Toute mutation tenant-aware doit passer par `createServices` ou une fonction de service equivalente.
- Ne jamais filtrer uniquement cote frontend : les requetes doivent inclure `tenant_id` et verifier le membership.
- Les secrets ne sont jamais exposes au navigateur et ne sont jamais commites.
- Les actions sensibles doivent creer une entree `audit_logs`.
- Les connecteurs passent par le framework commun : metadata, auth, sync, webhook, sante, erreurs normalisees.
- Les generations IA futures doivent passer par une abstraction et garder source, version et etat d'approbation.

## Tests attendus

- Tenant isolation pour chaque nouveau repository ou service partage.
- Tests integration pour formulaire public vers CRM et workflow.
- Tests connecteurs pour webhook et import CSV.
- Playwright pour le parcours vertical compte -> organisation -> onboarding -> site -> lead -> CRM.

## Checklist de fin

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- Verifier le flux dans le navigateur
- Documenter toute limite de production restante
