# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

OS-4 est clôturé sur les commits fonctionnels `f9c66dd` et `d2f920e`. La CI PostgreSQL `31240188121` et la continuité `31240188120` sont vertes. Après une interruption, le worker reprend le snapshot immuable, réconcilie chaque étape du plan depuis les preuves workflow et publie exactement un résultat dans le fil web + canal test, sans second clic d’exécution. Le retry visible dans Conversation est idempotent.

La prochaine phase candidate de la roadmap page 31 est OS-5 « Premier provider réel ». Commencer uniquement par un audit comparatif des frontières Resend, WhatsApp/Twilio, Teams et Slack déjà préparées. Sélectionner un seul provider dont une sandbox ou un essai gratuit peut produire une preuve conversationnelle complète avec coût nul, surface d’autorisation minimale et retour explicite `disabled` / `not_configured` / `awaiting_human_auth` avant configuration. Ne créer aucun compte, credential, consentement, endpoint public ou dépense sans l’autorisation humaine requise.

## Référence prompt maître

Relire les pages cœur 3-7, 31-33, 46, 48 et 69-71, puis les pages OS-5 indiquées par la carte de `docs/MASTER_PROMPT_REFERENCE.md`, en particulier 13-15, 26-30 et 64-68. La page 31 exige un premier provider « activé en sandbox ou vrai avec clés »; les pages 5, 6 et 32 interdisent de présenter une préparation comme une connexion réelle et exigent fournisseur désactivé sans clé.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Confirmer la PR #11 et les runs verts 31240188121 / 31240188120 du head incluant d2f920e.
4. Relire les pages cœur et la carte OS-5 avant d'actualiser masterPrompt.alignment.
5. Auditer les quatre frontières préparées sans ouvrir de console fournisseur ni demander de secret.
6. Produire une recommandation unique avec preuve attendue, coût, consentement, webhook, idempotence, audit et procédure de désactivation.
7. Si l'activation exige compte, MFA, OAuth, clé, domaine, endpoint public, quota ou dépense, consigner l'étape humaine exacte; ne pas simuler un état ready.
```

## Critères du prochain checkpoint

- un seul provider candidat, choisi par critères conversation-first et non par facilité;
- état initial explicitement `disabled`, `not_configured` ou `awaiting_human_auth`;
- aucune clé dans le chat, le navigateur, le code, les logs ou l’audit;
- activation, webhook, sync, santé et erreurs derrière le framework connecteur commun;
- tenant, membership, RLS, idempotence, anti-rejeu et audit sûr conservés;
- preuve web + canal concerné, provider sandbox/réel clairement distingué du mock;
- tests unitaires, intégration, PostgreSQL/RLS, provider, sécurité et Playwright pertinents;
- aucun paiement, déploiement, fusion ou effet externe irréversible sans autorisation.

## État de vérité

- Livré : OS-1, OS-2, OS-3 et OS-4 complet.
- Réel préparé : frontières Resend, WhatsApp/Twilio, Teams et Slack.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée.
- Mock : canal test, `tradikom_mock`, deux capacités génériques, compensation et reprise worker.
- Bloqué humain : comptes, credentials, consentements, MFA, endpoints publics, domaines, quotas et dépenses.
- Hors périmètre immédiat : OS-6 à OS-8, fusion et déploiement.
