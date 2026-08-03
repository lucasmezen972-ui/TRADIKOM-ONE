# Étapes suivantes TRADIKOM ONE OS

## Prochaine action concrète

Le premier checkpoint OS-4 est livré sur `dea0eab`; la CI `30784805475` et la continuité `30784805450` sont vertes. Chaque nouvelle exécution conserve désormais un snapshot borné et immuable de sa définition. Le worker reprend ce snapshot après un signal humain; un double signal ne crée ni second événement ni second audit, et une étape déjà réussie n'est pas rejouée.

La prochaine action est de finaliser cette reprise au niveau du fil canonique. Extraire la finalisation du plan conversationnel hors du seul appel synchrone `executeConversationActionPlan`, puis l'appeler lorsqu'une reprise worker termine la mission. Le plan, ses étapes et le message résultat doivent converger une seule fois sans demander un second clic d'exécution.

## Référence prompt maître

Relire avant la prochaine modification les pages 17-18, 28, 31-33, 35-36, 46, 48 et 69, en plus des pages cœur 3-7 et 69-71. La page 31 exige « plan confirmé, exécution multi-step, reprise, idempotence »; les pages 18, 32, 46 et 69 exigent signal humain, état visible dans la conversation, tests workflow et Playwright.

## Bloc de reprise exact

```text
1. Travailler uniquement dans /Users/TRADIKOM/Developer/TRADIKOM-ONE.
2. Vérifier le PDF maître, son SHA-256 et ses 71 pages, puis exécuter pnpm agent:continuity-check.
3. Confirmer la PR #11 et l'état des runs du head contenant dea0eab.
4. Relire les pages 17-18, 28, 31-33, 35-36, 46, 48 et 69 avant de modifier l'orchestrateur ou le worker.
5. Auditer executeConversationActionPlan et le handler workflow.resume; extraire une finalisation idempotente réutilisable au lieu de créer un second moteur.
6. Simuler un échec après la première capacité, envoyer le signal de retry depuis le chemin conversationnel, laisser le worker reprendre, puis vérifier un seul résultat miroir et aucune réexécution de la première capacité.
7. Conserver tradikom_mock, ne connecter aucun fournisseur réel, ne demander aucun secret et ne présenter aucune simulation comme réelle.
```

## Critères du prochain checkpoint

- plan confirmé et snapshot de définition immuable avant exécution;
- reprise worker tenant-scoped depuis le snapshot, sans définition active mutable;
- statuts des étapes du plan réconciliés avec les preuves du workflow;
- résultat ou échec sûr visible une seule fois dans le fil web + canal test;
- signal humain de retry ou annulation idempotent depuis l'expérience Conversation;
- audit sans entrée métier, idempotence et classification d'erreur conservés;
- tests unitaires, intégration, PostgreSQL/RLS, workflow, sécurité et Playwright pertinents;
- interface française et parcours mobile non régressés;
- fichiers de reprise synchronisés avant l'arrêt.

## État de vérité

- Livré : OS-1, OS-2, OS-3 et checkpoint OS-4 snapshot/reprise moteur.
- Réel préparé : frontières Resend, WhatsApp/Twilio, Teams et Slack.
- Réel connecté : aucun fournisseur.
- Sandbox : aucune configurée.
- Mock : canal test, deux capacités génériques, compensation et mission reprise localement.
- Bloqué humain : credentials, consentements, MFA, endpoints publics, quotas et dépenses.
- Hors périmètre immédiat : activation fournisseur OS-5, OS-6 à OS-8, fusion et déploiement.
