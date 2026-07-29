export const closedStageNames = [
  "gagne",
  "gagné",
  "perdu",
  "won",
  "lost",
] as const;

/**
 * Seuil par défaut d'une opportunité considérée bloquée. Chaque organisation
 * peut le redéfinir (`tenants.stalled_opportunity_days`) ; cette valeur reste
 * celle des organisations qui n'ont rien choisi, et les bornes ci-dessous sont
 * partagées entre le schéma zod et la contrainte SQL.
 */
export const stalledOpportunityDays = 7;
export const minStalledOpportunityDays = 1;
export const maxStalledOpportunityDays = 90;

/**
 * Fragment SQL réutilisable : exclut les étapes de pipeline terminales.
 * Les noms sont des littéraux internes, jamais une entrée utilisateur.
 */
export const openStageCondition = `lower(pipeline_stages.name) not in (${closedStageNames
  .map((name) => `'${name}'`)
  .join(", ")})`;

export function stalledBefore(now: Date, days = stalledOpportunityDays) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
