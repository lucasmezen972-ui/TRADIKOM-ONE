export const closedStageNames = [
  "gagne",
  "gagné",
  "perdu",
  "won",
  "lost",
] as const;

export const stalledOpportunityDays = 7;

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
