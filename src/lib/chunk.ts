/**
 * D1 accepts at most 100 bound parameters in a single query. A batch that
 * exceeds it doesn't get slower — it fails outright with "too many SQL
 * variables", so every multi-row write and every `id IN (…)` read in this app
 * has to be split into bounded chunks.
 *
 * This helper is the splitting mechanism. The chunk *sizes* deliberately live
 * next to their call sites rather than here, because the right number depends
 * on how many columns the specific row writes (parameters = rows × columns);
 * see the constants in src/lib/plaid-sync.ts and src/lib/ledger.ts.
 */
export const D1_MAX_BOUND_PARAMS = 100;

export function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
