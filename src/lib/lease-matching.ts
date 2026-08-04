/**
 * Suggests which lease an imported row's payer/description text belongs to.
 * Deliberately simple and explainable rather than a fuzzy-matching library:
 * normalize both sides, score by how many of the lease's distinguishing
 * words show up in the row text, and only suggest a match when one lease is
 * unambiguously the best fit. A wrong *suggestion* just means one more click
 * on the review screen — a wrong *silent* match would misfile someone's rent,
 * so ambiguity always loses to leaving it for a human.
 */

export type MatchableLease = {
  leaseId: string;
  tenantFirstName: string;
  tenantLastName: string;
  unitLabel: string;
  propertyName: string;
};

export type LeaseMatch = {
  leaseId: string;
  score: number;
} | null;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function leaseTokens(lease: MatchableLease): string[] {
  return [
    ...tokenize(lease.tenantFirstName),
    ...tokenize(lease.tenantLastName),
    ...tokenize(lease.unitLabel),
    ...tokenize(lease.propertyName),
  ];
}

/**
 * Scores every candidate lease against a row's text and returns the best
 * match — but only if it's unambiguous (strictly higher than the runner-up).
 * A tie, or no token overlap at all, returns null and the row stays
 * unmatched until a human picks one.
 */
export function suggestLeaseMatch(rowText: string, candidates: MatchableLease[]): LeaseMatch {
  const rowTokens = new Set(tokenize(rowText));
  if (rowTokens.size === 0 || candidates.length === 0) return null;

  let best: { leaseId: string; score: number } | null = null;
  let bestCount = 0;
  let runnerUpScore = 0;

  for (const lease of candidates) {
    const tokens = leaseTokens(lease);
    if (tokens.length === 0) continue;

    // Weight full-name-token matches (first/last name) higher than a unit
    // label match alone — "2B" is a much weaker signal than "Fernandez".
    let score = 0;
    for (const token of new Set(tokens)) {
      if (rowTokens.has(token)) score += token.length >= 3 ? 2 : 1;
    }
    if (score === 0) continue;

    if (score > bestCount) {
      runnerUpScore = bestCount;
      bestCount = score;
      best = { leaseId: lease.leaseId, score };
    } else if (score > runnerUpScore) {
      runnerUpScore = score;
    }
  }

  if (!best) return null;
  if (best.score === runnerUpScore) return null; // tie — ambiguous, don't guess
  return best;
}
