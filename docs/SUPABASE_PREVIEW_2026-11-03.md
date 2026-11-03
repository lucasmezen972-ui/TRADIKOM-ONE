# Supabase et préversion vérifiés — 3 novembre 2026

Le lot applicatif 125–132 a été appliqué avec succès après confirmation native. Vérification réelle : journal 132, dernière migration 132_github_public_connectors_rls ; cinq nouvelles tables appartenant à tradikom_owner avec RLS active ; zéro politique générique tenant_isolation sur ces tables et zéro privilège direct anon/authenticated. Analyseur sécurité Supabase : zéro alerte. Le moteur reste 17.6, son upgrade fournisseur est distinct.

Le candidat 4c4619d5e15e2b303b4e80486b629d35e8c41d44 est déployé en preview, déploiement dpl_81smzYPqTYhfZqcAtFbHeYd5aCYZ, état READY. L’URL exacte du candidat /api/health répond HTTP 200, ok=true, database=ok à 2026-11-03T05:40:21.278Z. La protection Vercel demeure active. Aucun déploiement de production ni GitHub Actions.

Le contrôle via SET ROLE du connecteur SQL a été refusé ; aucun privilège n’a été élargi. La connexion du compte runtime est prouvée par le contrôle de santé réel du nouveau candidat, qui vérifie les 132 migrations. Le parcours utilisateur après connexion sur cette base hébergée n’est pas déduit de ce health. Les quatre parcours Playwright précédents restent des preuves du banc local.

Clé OpenAI créée dans le fichier cloud confirmé, hors Git ; non installée dans Vercel et appels payants toujours désactivés. Les anciens blocages de confirmation ci-dessus sont historiques ; ils sont levés pour ce lot.

Préversion : https://tradikom-one-git-codex-tradik-3e15f6-lucasmezen972-uis-projects.vercel.app/
